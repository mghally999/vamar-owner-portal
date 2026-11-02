// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/test/api';
import { building, buildingDetail } from '@/test/fixtures';
import { at, renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuildingsPage', () => {
  it('shows each building with its units and occupancy', async () => {
    const { api, user } = await renderApp('/buildings', {
      routes: {
        'GET /api/staff/buildings': {
          items: [building(), building({ id: 'bld-2', nameEn: 'Marina Heights', unitCount: 0 })],
        },
        'GET /api/staff/buildings/:id': buildingDetail(),
      },
    });
    const card = await screen.findByRole('link', { name: /Al Noor Tower/ });
    expect(card.getAttribute('href')).toBe('/buildings/bld-1');
    expect(within(card).getByText('12 units')).toBeTruthy();
    expect(within(card).getByText('9 rented')).toBeTruthy();
    expect(within(card).getByText('Business Bay')).toBeTruthy();
    expect(screen.getByText('Marina Heights')).toBeTruthy();

    await user.hover(card);
    await vi.waitFor(() => {
      expect(api.to('GET', '/api/staff/buildings/bld-1')).toHaveLength(1);
    });
  });

  it('creates a building from the empty state', async () => {
    const { api, user } = await renderApp('/buildings', {
      role: 'editor',
      routes: {
        'GET /api/staff/buildings': { items: [] },
        'POST /api/staff/buildings': building({ id: 'bld-9' }),
      },
    });
    expect(
      await screen.findByText('No buildings yet. Create a building, then add its units.'),
    ).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'New building' });
    expect(buttons).toHaveLength(2);
    await user.click(at(buttons, 1));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(api.to('POST', '/api/staff/buildings')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/Building name \(Arabic\)/), 'برج الواحة');
    await user.type(within(dialog).getByLabelText(/Building name \(English\)/), 'Oasis Tower');
    await user.type(within(dialog).getByLabelText(/Area \/ community/), 'JLT');
    await user.type(within(dialog).getByLabelText(/Address/), 'Cluster D');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/buildings').body).toEqual({
      nameAr: 'برج الواحة',
      nameEn: 'Oasis Tower',
      area: 'JLT',
      address: 'Cluster D',
      notes: '',
    });
    // The list is fetched again after the create.
    expect(api.to('GET', '/api/staff/buildings').length).toBeGreaterThan(1);
  });

  it('hides creation from viewers and shows the error state', async () => {
    await renderApp('/buildings', {
      role: 'viewer',
      routes: { 'GET /api/staff/buildings': apiError(503, 'unavailable') },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New building' })).toBeNull();
  });

  it('shows an empty list to a viewer without a create button', async () => {
    await renderApp('/buildings', {
      role: 'viewer',
      routes: { 'GET /api/staff/buildings': { items: [] } },
    });
    expect(
      await screen.findByText('No buildings yet. Create a building, then add its units.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New building' })).toBeNull();
  });
});
