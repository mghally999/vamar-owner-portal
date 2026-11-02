// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { building, contractDetail, contractRow, page } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BUILDINGS = {
  items: [building(), building({ id: 'bld-2', nameAr: 'مرسى', nameEn: 'Marina Heights' })],
};

describe('ContractsPage', () => {
  it('lists contracts and sends the chosen filters', async () => {
    const { api, user } = await renderApp('/contracts', {
      routes: {
        'GET /api/staff/buildings': BUILDINGS,
        'GET /api/staff/contracts': (c: ApiCall) =>
          page(
            [contractRow({ status: (c.query['status'] as 'active' | undefined) ?? 'active' })],
            c.query['cursor'] ? null : 'next',
          ),
        'GET /api/staff/contracts/:id': contractDetail(),
      },
    });
    const link = await screen.findByRole('link', { name: 'Al Noor Tower · 801' });
    expect(link.getAttribute('href')).toBe('/contracts/con-1');
    const row = link.closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Sara Khan')).toBeTruthy();
    expect(within(row).getByText('AED 95,000')).toBeTruthy();
    expect(within(row).getByText('Active')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New contract' }).getAttribute('href')).toBe(
      '/contracts/new',
    );

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'draft');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Building' }), 'bld-2');
    await user.click(screen.getByRole('checkbox', { name: 'Contracts ending within 60 days' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/contracts').query).toEqual({
        status: 'draft',
        buildingId: 'bld-2',
        endingWithinDays: '60',
        limit: '50',
      });
    });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/contracts').query['cursor']).toBe('next');
    });

    await user.hover(at(screen.getAllByRole('link', { name: 'Al Noor Tower · 801' }), 0));
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/contracts/con-1')).toHaveLength(1);
    });
  });

  it('starts with the ending-soon filter when linked from the overview', async () => {
    const { api } = await renderApp('/contracts?endingWithinDays=60', {
      role: 'viewer',
      routes: {
        'GET /api/staff/buildings': BUILDINGS,
        'GET /api/staff/contracts': page([]),
      },
    });
    expect(
      await screen.findByText(
        'No contracts yet. Create a contract to generate its cheque schedule.',
      ),
    ).toBeTruthy();
    expect(api.last('GET', '/api/staff/contracts').query['endingWithinDays']).toBe('60');
    expect(
      screen.getByRole('checkbox', {
        name: 'Contracts ending within 60 days',
      }),
    ).toHaveProperty('checked', true);
    expect(screen.queryByRole('link', { name: 'New contract' })).toBeNull();
  });

  it('shows the error state', async () => {
    await renderApp('/contracts', {
      routes: {
        'GET /api/staff/buildings': BUILDINGS,
        'GET /api/staff/contracts': apiError(500, 'internal'),
      },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
