// @vitest-environment jsdom
/**
 * Building detail, property-record side: the identifiers card and its editor, the unit rows'
 * record details (deed number, effective status), and the History tab with filters and paging.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { buildingDetail, unit } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { timelineEntries } from '@/v2/test-fixtures';
import type { TimelineEntry } from '@/v2/types';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RECORDED = buildingDetail({
  plotNo: '346-1180',
  makaniNo: '2735894120',
  titleDeedNo: 'BB-2015-0346',
  completionYear: 2016,
  floorsCount: 24,
  units: [
    unit({ titleDeedNo: 'TD-1-001', effectiveStatus: 'occupied' } as never),
    unit({
      id: 'unit-802',
      unitNo: '802',
      owners: [],
      occupied: false,
      contract: null,
      bedrooms: null,
      effectiveStatus: 'under_maintenance',
    } as never),
  ],
} as never);

const withUnit = (e: TimelineEntry, unitNo: string): TimelineEntry => ({ ...e, unitNo });

describe('BuildingDetailPage records', () => {
  it('shows the identifiers, each unit deed number and effective status', async () => {
    await renderApp('/buildings/bld-1', {
      routes: { 'GET /api/staff/buildings/bld-1': RECORDED },
    });
    expect(await screen.findByText('346-1180')).toBeTruthy();
    expect(screen.getByText('2735894120')).toBeTruthy();
    expect(screen.getByText('BB-2015-0346')).toBeTruthy();
    expect(screen.getByText('2016')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('TD-1-001')).toBeTruthy();
    expect(screen.getByText('Under maintenance')).toBeTruthy();
    expect(screen.getByText('Occupied')).toBeTruthy();
  });

  it('shows dashes for a building without identifiers and hides editing from viewers', async () => {
    await renderApp('/buildings/bld-1', {
      role: 'viewer',
      routes: { 'GET /api/staff/buildings/bld-1': buildingDetail() },
    });
    expect(await screen.findByText('Property record')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole('button', { name: 'Edit identifiers' })).toBeNull();
  });

  it('edits the identifiers, refusing a bad Makani number, year or floor count', async () => {
    const { api, user } = await renderApp('/buildings/bld-1', {
      role: 'editor',
      routes: {
        'GET /api/staff/buildings/bld-1': RECORDED,
        'PATCH /api/staff/buildings/:id/identifiers': { ok: true },
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit identifiers' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    const makani = within(dialog).getByLabelText(/Makani no\./);
    expect(makani).toHaveProperty('value', '2735894120');

    await user.clear(makani);
    await user.type(makani, '12345');
    expect(save).toHaveProperty('disabled', true);
    await user.clear(makani);
    await user.type(makani, '1234567890');
    expect(save).toHaveProperty('disabled', false);

    const year = within(dialog).getByLabelText(/Completion year/);
    await user.clear(year);
    await user.type(year, '1800');
    expect(save).toHaveProperty('disabled', true);
    await user.clear(year);

    const floors = within(dialog).getByLabelText(/Floors/);
    await user.clear(floors);
    await user.type(floors, 'ten');
    expect(save).toHaveProperty('disabled', true);
    await user.clear(floors);
    await user.type(floors, '25');

    await user.clear(within(dialog).getByLabelText(/Plot no\./));
    await user.click(save);
    expect(await screen.findByText('Identifiers saved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/buildings/bld-1/identifiers').body).toEqual({
      plotNo: null,
      makaniNo: '1234567890',
      titleDeedNo: 'BB-2015-0346',
      completionYear: null,
      floorsCount: 25,
    });
  });

  it('keeps the dialog open with a message when saving fails, and closes on cancel', async () => {
    const { user } = await renderApp('/buildings/bld-1', {
      role: 'editor',
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail(),
        'PATCH /api/staff/buildings/:id/identifiers': apiError(500, 'internal'),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit identifiers' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Title deed no\./), 'BB-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('lists the building history with unit numbers, filters by kind and loads more', async () => {
    const [status, cheque, expense, contract] = timelineEntries() as [
      TimelineEntry,
      TimelineEntry,
      TimelineEntry,
      TimelineEntry,
    ];
    const { api, user } = await renderApp('/buildings/bld-1', {
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail(),
        'GET /api/staff/buildings/:id/timeline': (c: ApiCall) => {
          if (c.query['kinds'] === 'status,contract,tenant,expense,work_order,dispute,ownership')
            return { items: [withUnit(status, '801')], nextCursor: null };
          return c.query['cursor'] === 'tl-2'
            ? { items: [withUnit(contract, '802')], nextCursor: null }
            : {
                items: [withUnit(status, '801'), withUnit(cheque, '801'), withUnit(expense, '802')],
                nextCursor: 'tl-2',
              };
        },
      },
    });
    await user.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByText('801 · Status set to Under maintenance')).toBeTruthy();
    expect(screen.getByText('801 · Cheque 000101 cleared')).toBeTruthy();
    expect(screen.getByText('802 · Variable expense: AC breakdown')).toBeTruthy();
    expect(api.last('GET', '/api/staff/buildings/bld-1/timeline').query).toEqual({ limit: '30' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('802 · Contract started with Sara Khan')).toBeTruthy();
    expect(api.last('GET', '/api/staff/buildings/bld-1/timeline').query['cursor']).toBe('tl-2');
    // Everything from both pages stays on screen, and the button goes once the end is reached.
    expect(screen.getByText('801 · Cheque 000101 cleared')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Cheques' }));
    await vi.waitFor(() => {
      expect(screen.queryByText('801 · Cheque 000101 cleared')).toBeNull();
    });
    expect(api.last('GET', '/api/staff/buildings/bld-1/timeline').query['cursor']).toBeUndefined();

    await user.click(screen.getByRole('tab', { name: 'Units' }));
    expect(screen.getByRole('tab', { name: 'Units' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows an empty history and the error state of the history', async () => {
    const { user } = await renderApp('/buildings/bld-1', {
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail(),
        'GET /api/staff/buildings/:id/timeline': { items: [], nextCursor: null },
      },
    });
    await user.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Nothing recorded yet for this unit.')).toBeTruthy();
    cleanup();
    const second = await renderApp('/buildings/bld-1', {
      routes: {
        'GET /api/staff/buildings/bld-1': buildingDetail(),
        'GET /api/staff/buildings/:id/timeline': apiError(500, 'internal'),
        // The budget section has its own Retry when its request fails; it answers here.
        'GET /api/staff/budgets': { year: 2026, today: '2026-10-07', buildings: [] },
      },
    });
    await second.user.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
