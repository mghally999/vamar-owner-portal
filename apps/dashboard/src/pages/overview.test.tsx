// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { contractDetail, overview } from '@/test/fixtures';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OverviewPage', () => {
  it('shows the month totals, the lists and the occupancy from the API', async () => {
    await renderApp('/', { routes: { 'GET /api/staff/overview': overview() } });

    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(screen.getByText('Expected this month')).toBeTruthy();
    expect(screen.getByText('475,000')).toBeTruthy();
    expect(screen.getByText('18 cheques')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: '30 of 40 units rented' });
    expect(bar.getAttribute('aria-valuenow')).toBe('75');

    expect(screen.getByText('Yusuf Tariq')).toBeTruthy();
    expect(screen.getByText('Liam Carter')).toBeTruthy();
    expect(screen.getByText('Nadia Rahman')).toBeTruthy();
    expect(screen.getByText('Renewal draft ready')).toBeTruthy();

    // Admins see deletion requests; a request without an owner shows a dash.
    expect(screen.getByText('Account deletion requests')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Khalid Noor' }).getAttribute('href')).toBe(
      '/owners/own-7',
    );
    expect(screen.getByText('+971507776666')).toBeTruthy();
  });

  it('renews a contract and opens the new draft', async () => {
    const { api, router, user } = await renderApp('/', {
      role: 'editor',
      routes: {
        'GET /api/staff/overview': overview(),
        'POST /api/staff/contracts/:id/renew': contractDetail({ id: 'con-new', status: 'draft' }),
        'GET /api/staff/contracts/:id': contractDetail({ id: 'con-new', status: 'draft' }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Renew' }));
    expect(api.last('POST', '/api/staff/contracts/con-9/renew')).toBeTruthy();
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/contracts/con-new');
    });
    // Editors never see deletion requests.
    expect(screen.queryByText('Account deletion requests')).toBeNull();
  });

  it('hides the renew button for a viewer and shows empty lists', async () => {
    await renderApp('/', {
      role: 'viewer',
      routes: {
        'GET /api/staff/overview': overview({
          bounced: [],
          dueSoon: [],
          endingSoon: [],
          deletionRequests: [],
        }),
      },
    });
    expect(await screen.findByText('No bounced cheques. Good.')).toBeTruthy();
    expect(screen.getByText('No cheques are due in the next 7 days.')).toBeTruthy();
    expect(screen.getByText('No contracts end in the next 60 days.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Renew' })).toBeNull();
  });

  it('shows Arabic labels and amounts in Arabic', async () => {
    await renderApp('/', { lang: 'ar', routes: { 'GET /api/staff/overview': overview() } });
    expect(await screen.findByText('أكتوبر 2026')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    const hero = screen.getByText('المتوقع هذا الشهر').closest('section');
    expect(hero && within(hero).getAllByText('درهم').length).toBeGreaterThan(0);
  });

  it('shows the error state with a retry when the API fails', async () => {
    const { api, user } = await renderApp('/', {
      routes: { 'GET /api/staff/overview': apiError(500, 'internal') },
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(retry);
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/overview').length).toBeGreaterThan(1);
    });
  });
});
