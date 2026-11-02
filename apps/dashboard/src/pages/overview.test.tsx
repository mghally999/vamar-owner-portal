// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { contractDetail, overview } from '@/test/fixtures';
import { reportSummary, v2Routes } from '@/test/fixtures-v2';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/overview': overview(),
    'GET /api/staff/reports/summary': reportSummary(),
    ...extra,
  });

describe('OverviewPage', () => {
  it('shows the period cards, the chart, the lists and the occupancy from the API', async () => {
    const { api } = await renderApp('/', { routes: routes() });

    expect(await screen.findByText('Expected rent')).toBeTruthy();
    expect(screen.getByText('80,000')).toBeTruthy(); // expected 8,000,000 fils
    expect(screen.getByText('60,000')).toBeTruthy(); // collected
    expect(screen.getByText('16,000')).toBeTruthy(); // expenses
    expect(screen.getByText('44,000')).toBeTruthy(); // net
    expect(screen.getByText("Before Vamar's management fee")).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Rent and expenses by month' })).toBeTruthy();
    expect(api.last('GET', '/api/staff/reports/summary').query).toEqual({ preset: 'this_month' });
    expect(screen.getByRole('link', { name: /Expected rent/ }).getAttribute('href')).toContain(
      '/cheques?preset=this_month',
    );
    expect(screen.getByRole('link', { name: /At risk/ }).getAttribute('href')).toContain(
      'status=bounced',
    );

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

  it('switches the period from the chips and compares with the previous period', async () => {
    const { api, router, user } = await renderApp('/', {
      routes: routes({
        'GET /api/staff/reports/summary': (c: ApiCall) =>
          c.query['compare'] === '1'
            ? reportSummary({
                previous: {
                  rent: { ...reportSummary().rent, expectedFils: 4_000_000 },
                  expenses: reportSummary().expenses,
                  netFils: 2_000_000,
                },
              })
            : reportSummary(),
      }),
    });
    await screen.findByText('Expected rent');
    await user.click(screen.getByRole('radio', { name: 'This year' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/reports/summary').query).toEqual({ preset: 'this_year' });
    });
    expect(router.state.location.search).toMatchObject({ preset: 'this_year' });
    await user.click(screen.getByRole('checkbox', { name: 'Compare with the previous period' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/reports/summary').query).toEqual({
        preset: 'this_year',
        compare: '1',
      });
    });
    expect(await screen.findByText(/100% vs previous period/)).toBeTruthy();
  });

  it('renews a contract and opens the new draft', async () => {
    const { api, router, user } = await renderApp('/', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/contracts/:id/renew': contractDetail({ id: 'con-new', status: 'draft' }),
        'GET /api/staff/contracts/:id': contractDetail({ id: 'con-new', status: 'draft' }),
      }),
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
      routes: routes({
        'GET /api/staff/overview': overview({
          bounced: [],
          dueSoon: [],
          endingSoon: [],
          deletionRequests: [],
        }),
      }),
    });
    expect(await screen.findByText('No bounced cheques. Good.')).toBeTruthy();
    expect(screen.getByText('No cheques are due in the next 7 days.')).toBeTruthy();
    expect(screen.getByText('No contracts end in the next 60 days.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Renew' })).toBeNull();
  });

  it('shows Arabic labels and amounts in Arabic', async () => {
    await renderApp('/', { lang: 'ar', routes: routes() });
    const labels = await screen.findAllByText('الإيجار المتوقع');
    expect(document.documentElement.dir).toBe('rtl');
    const card = labels[0]?.closest('a') ?? null;
    expect(card && within(card).getAllByText('درهم').length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: 'هذا الشهر' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('shows the error state with a retry when the API fails', async () => {
    const { api, user } = await renderApp('/', {
      routes: routes({
        'GET /api/staff/overview': apiError(500, 'internal'),
        'GET /api/staff/reports/summary': apiError(500, 'internal'),
      }),
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(retry);
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/overview').length).toBeGreaterThan(1);
    });
  });
});
