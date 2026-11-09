// @vitest-environment jsdom
/**
 * The unit record page beyond the happy path: a bare unit (no building, owners, contracts or
 * handover), errors and retries of each section, the status dialog's generic error and cancel,
 * and the identifiers editor's handover date and Makani check.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { statusHistory, timelineEntries, unitRecord } from './test-fixtures';
import { renderV2 } from './test-render';
import type { TimelineEntry } from './types';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BARE = unitRecord({
  building: null as never,
  bedrooms: null,
  owners: [],
  contracts: [],
  handoverDate: null,
  titleDeedNo: null,
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/units/unit-801': unitRecord(),
    'GET /api/staff/units/unit-801/status-history': { items: statusHistory },
    'GET /api/staff/units/unit-801/timeline': { items: timelineEntries(), nextCursor: null },
    ...extra,
  };
}

describe('UnitPage, more', () => {
  it('shows a bare unit with empty sections and retries a failed history and timeline', async () => {
    let fail = true;
    const { user } = await renderV2('/units/unit-801', {
      routes: routes({
        'GET /api/staff/units/unit-801': BARE,
        'GET /api/staff/units/unit-801/status-history': () =>
          fail ? apiError(500, 'internal') : { items: [] },
        'GET /api/staff/units/unit-801/timeline': () =>
          fail ? apiError(500, 'internal') : { items: [], nextCursor: null },
      }),
    });
    expect(await screen.findByRole('heading', { name: 'Unit 801' })).toBeTruthy();
    expect(screen.getByText('No owners yet')).toBeTruthy();
    expect(screen.getByText('No contracts yet.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Al Noor Tower' })).toBeNull();
    const retries = await screen.findAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);
    fail = false;
    for (const r of retries) await user.click(r);
    expect(await screen.findByText('Nothing recorded yet for this unit.')).toBeTruthy();
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  });

  it('retries the whole page when the unit cannot load', async () => {
    let fail = true;
    const { user } = await renderV2('/units/unit-801', {
      routes: routes({
        'GET /api/staff/units/unit-801': () => (fail ? apiError(500, 'internal') : unitRecord()),
      }),
    });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole('heading', { name: 'Unit 801' })).toBeTruthy();
  });

  it('shows a status change without a previous status', async () => {
    await renderV2('/units/unit-801', {
      routes: routes({
        'GET /api/staff/units/unit-801/status-history': {
          items: [{ ...statusHistory[0], id: 'use-0', fromStatus: null, toStatus: 'reserved' }],
        },
      }),
    });
    expect(await screen.findByText('Reserved')).toBeTruthy();
  });

  it('links each kind of history entry to its record and survives an event key it does not know', async () => {
    const [base] = timelineEntries();
    if (!base) throw new Error('no fixture');
    const entry = (e: Partial<TimelineEntry>): TimelineEntry => ({
      ...base,
      detailAr: '',
      detailEn: '',
      amountFils: null,
      ...e,
    });
    await renderV2('/units/unit-801', {
      routes: routes({
        'GET /api/staff/units/unit-801/timeline': {
          items: [
            entry({
              id: 'dispute:dsp-7',
              kind: 'dispute',
              titleAr: 'dispute_opened',
              titleEn: 'DSP-7',
              entityType: 'dispute',
              entityId: 'dsp-7',
            }),
            entry({
              id: 'ownership:own-1',
              kind: 'ownership',
              titleAr: 'ownership_from',
              titleEn: 'Mona Saeed',
              entityType: 'owner',
              entityId: 'own-1',
            }),
            entry({
              id: 'work_order:wo-3',
              kind: 'work_order',
              at: '2026-10-05T10:30:00.000Z',
              titleAr: 'work_order_done',
              titleEn: 'Leak in kitchen',
              detailEn: 'Plumber visit',
              entityType: 'work_order',
              entityId: 'wo-3',
              amountFils: 45_000,
            }),
            entry({ id: 'status:use-9', titleEn: 'archived', entityType: 'unit' }),
            entry({
              id: 'tenant:x-1',
              kind: 'tenant',
              titleAr: 'tenant_keys_returned',
              titleEn: 'Sara Khan',
              entityType: 'tenant',
              entityId: 'ten-1',
            }),
          ],
          nextCursor: null,
        },
      }),
    });
    expect(await screen.findByRole('link', { name: 'Case DSP-7 opened' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Owner: Mona Saeed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Work order done: Leak in kitchen' })).toBeTruthy();
    // A timed entry shows its time; the detail sits beside it.
    expect(screen.getByText('5 Oct 2026 14:30')).toBeTruthy();
    expect(screen.getByText('Plumber visit')).toBeTruthy();
    // A status the labels do not know is shown as sent.
    expect(screen.getByText('Status set to archived')).toBeTruthy();
    // An event key newer than this build: the raw key and subject, not a crash, and no link.
    const unknown = screen.getByText('tenant_keys_returned Sara Khan');
    expect(unknown.closest('a')).toBeNull();
  });

  it('says when the unit already has the chosen status', async () => {
    const { user } = await renderV2('/units/unit-801', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/units/unit-801/status-history': {
          items: [{ ...statusHistory[0], id: 'use-2', actorName: null }],
        },
        'POST /api/staff/units/unit-801/status': apiError(409, 'conflict'),
      }),
    });
    // A change made by the system has no actor: only the time is shown.
    expect(await screen.findByText('Repainting before the next tenant')).toBeTruthy();
    expect(screen.queryByText('Mariam Haddad')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Ready again');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The unit already has this status.')).toBeTruthy();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('starts the identifiers empty for a unit without any and reports a refused save', async () => {
    const { api, user } = await renderV2('/units/unit-801', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/units/unit-801': unitRecord({
          titleDeedNo: null,
          plotNo: null,
          makaniNo: null,
          dewaPremiseNo: null,
          municipalityNo: null,
          handoverDate: null,
        }),
        'PATCH /api/staff/units/unit-801/identifiers': apiError(500, 'internal'),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Edit identifiers' }));
    const dialog = await screen.findByRole('dialog');
    for (const input of within(dialog).getAllByRole('textbox')) {
      expect(input).toHaveProperty('value', '');
    }
    await user.type(within(dialog).getByLabelText(/DEWA \/ SEWA account no\./), '301000977');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/units/unit-801/identifiers').body).toEqual({
      titleDeedNo: null,
      plotNo: null,
      makaniNo: null,
      dewaPremiseNo: '301000977',
      municipalityNo: null,
      handoverDate: null,
    });
  });

  it('reports a generic error from the status change and closes on cancel', async () => {
    const { user } = await renderV2('/units/unit-801', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/units/unit-801': unitRecord({ status: 'under_maintenance' }),
        'POST /api/staff/units/unit-801/status': apiError(500, 'internal'),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    const status = within(dialog).getByLabelText(/^Status/);
    // A unit under maintenance offers "vacant, ready" first.
    expect(status).toHaveProperty('value', 'vacant_ready');
    await user.selectOptions(status, 'not_available');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Owner asked to hold it');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('edits the handover date and refuses a short Makani number, then closes on Escape', async () => {
    const { api, user } = await renderV2('/units/unit-801', {
      role: 'editor',
      routes: routes({
        'PATCH /api/staff/units/unit-801/identifiers': (c: ApiCall) => unitRecord(c.body as object),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Edit identifiers' }));
    let dialog = await screen.findByRole('dialog');
    const makani = within(dialog).getByLabelText(/Makani no\./);
    await user.clear(makani);
    await user.type(makani, '123');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await user.clear(makani);
    const handover = within(dialog).getByLabelText(/Handover date/);
    await user.clear(handover);
    await user.type(handover, '15/07/2016{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Identifiers saved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/units/unit-801/identifiers').body).toMatchObject({
      makaniNo: null,
      handoverDate: '2016-07-15',
    });

    await user.click(screen.getByRole('button', { name: 'Edit identifiers' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear date' }));
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
