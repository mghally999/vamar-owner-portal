// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { building } from '@/test/fixtures';
import type { ApiCall } from '@/test/api';
import { calendarEvent, calendarItems, holidays, settings } from './test-fixtures';
import { pickOption } from '@/test/render';
import { renderV2 } from './test-render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/settings': settings(),
    'GET /api/staff/holidays': { items: holidays },
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/owners': { items: [], nextCursor: null },
    'GET /api/staff/calendar': (c: ApiCall) => ({
      items: calendarItems().filter(
        (i) => !c.query['kinds'] || (c.query['kinds'] ?? '').split(',').includes(i.kind),
      ),
    }),
    'GET /api/staff/calendar-events/evt-1': calendarEvent,
    'POST /api/staff/calendar-events': (c: ApiCall) => ({ id: 'evt-2', ...(c.body as object) }),
    'PATCH /api/staff/calendar-events/evt-1': (c: ApiCall) => ({
      ...calendarEvent,
      ...(c.body as object),
    }),
    'DELETE /api/staff/calendar-events/evt-1': { ok: true },
    ...extra,
  };
}

describe('CalendarPage', () => {
  it('opens on the current month, asks for the visible range and draws the items with their kinds', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T08:00:00+04:00') });
    const { api } = await renderV2('/calendar', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    expect(await screen.findByText('Cheque 000101 · Al Noor Tower 801')).toBeTruthy();
    expect(screen.getByText('Annual inspection')).toBeTruthy();
    expect(screen.getByText('Hearing RDC-2026-0412 (000101)')).toBeTruthy();
    const q = api.last('GET', '/api/staff/calendar').query;
    expect((q['from'] ?? '') <= '2026-10-01').toBe(true);
    expect((q['to'] ?? '') >= '2026-10-31').toBe(true);
    expect(q['kinds']).toBeUndefined();
    const legend = screen.getByText('Legend').parentElement;
    if (!legend) throw new Error('no legend');
    expect(within(legend).getByText('Cheque due')).toBeTruthy();
    expect(within(legend).getByText('Holiday')).toBeTruthy();
    expect(screen.getByText('4 items')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Month', selected: true })).toBeTruthy();
  });

  it('switches views, moves between months, jumps to a month and filters the kinds', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T08:00:00+04:00') });
    const { api, user } = await renderV2('/calendar', { routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), '12');
    expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeTruthy();
    await vi.waitFor(() => {
      expect((api.last('GET', '/api/staff/calendar').query['to'] ?? '') >= '2026-12-31').toBe(true);
    });
    await user.click(screen.getByRole('tab', { name: 'Year' }));
    expect(await screen.findByRole('heading', { name: '2026' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(await screen.findByRole('tab', { name: 'List', selected: true })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Month' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cheque due' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/calendar').query['kinds']).toBe(
        'contract_end,contract_renewal,hearing,work_order,holiday,event',
      );
    });
  });

  it('opens the side panel with a link to the entity, and explains why only events move', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T08:00:00+04:00') });
    const { user } = await renderV2('/calendar', { role: 'editor', routes: routes() });
    await user.click(await screen.findByText('Hearing RDC-2026-0412 (000101)'));
    const panel = await screen.findByRole('region', { name: 'Hearing RDC-2026-0412 (000101)' });
    expect(within(panel).getByRole('link', { name: 'Open the case' }).getAttribute('href')).toBe(
      '/disputes/dsp-1',
    );
    expect(within(panel).getByText(/changed from their own pages/)).toBeTruthy();
    expect(within(panel).getByText('21 Oct 2026')).toBeTruthy();
    await user.click(screen.getByText('Annual inspection'));
    const event = await screen.findByRole('region', { name: 'Annual inspection' });
    expect(within(event).getByText(/15 Oct 2026 · 10:00/)).toBeTruthy();
    expect(within(event).getByRole('button', { name: 'Edit event' })).toBeTruthy();
    expect(within(event).getByRole('button', { name: 'Delete event' })).toBeTruthy();
  });

  it('creates, edits and deletes a manual event', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T08:00:00+04:00') });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, user } = await renderV2('/calendar', { role: 'editor', routes: routes() });
    await user.click(await screen.findByRole('button', { name: 'New event' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Title \(Arabic\)/), 'اجتماع');
    await user.type(within(dialog).getByLabelText(/Title \(English\)/), 'Meeting');
    await user.selectOptions(within(dialog).getByLabelText(/Event type/), 'meeting');
    await pickOption(user, within(dialog).getByLabelText(/^Building/), 'bld-1');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Owner can see this event' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('POST', '/api/staff/calendar-events').body).toEqual({
        titleAr: 'اجتماع',
        titleEn: 'Meeting',
        startsAt: '2026-10-07T10:00:00+04:00',
        endsAt: '2026-10-07T11:00:00+04:00',
        allDay: false,
        type: 'meeting',
        buildingId: 'bld-1',
        visibleToOwner: true,
        notes: '',
      });
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();

    await user.click(await screen.findByText('Annual inspection'));
    await user.click(await screen.findByRole('button', { name: 'Edit event' }));
    const edit = await screen.findByRole('dialog');
    const title = await within(edit).findByDisplayValue('Annual inspection');
    await user.clear(title);
    await user.type(title, 'Annual inspection (roof)');
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/calendar-events/evt-1').body).toMatchObject({
        titleEn: 'Annual inspection (roof)',
        startsAt: '2026-10-15T10:00:00+04:00',
        endsAt: '2026-10-15T11:30:00+04:00',
      });
    });

    await user.click(await screen.findByText('Annual inspection'));
    await user.click(await screen.findByRole('button', { name: 'Delete event' }));
    await vi.waitFor(() => {
      expect(api.to('DELETE', '/api/staff/calendar-events/evt-1')).toHaveLength(1);
    });
  });

  it('is right-to-left with Arabic month names and Western digits, and read-only for viewers', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T08:00:00+04:00') });
    const { container } = await renderV2('/calendar', {
      role: 'viewer',
      lang: 'ar',
      routes: routes(),
    });
    expect(await screen.findByRole('heading', { name: 'أكتوبر 2026' })).toBeTruthy();
    expect(await screen.findByText('شيك 000101 · برج النور 801')).toBeTruthy();
    expect(container.querySelector('.fc-direction-rtl')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'موعد جديد' })).toBeNull();
    expect(screen.getByText('4 عناصر')).toBeTruthy();
  });
});
