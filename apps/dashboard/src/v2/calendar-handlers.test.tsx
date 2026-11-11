// @vitest-environment jsdom
/**
 * The calendar page's own behaviour around FullCalendar: the library is replaced by a stub that
 * keeps the props the page passes, so the handlers (drag of a manual event and its revert, item
 * click, holiday and weekend shading, titles per view, toolbar, formatters) are driven directly.
 * Drawing and dragging themselves are the library's job and are not re-tested here.
 */
import { act, cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiCall } from '@/test/api';
import { apiError } from '@/test/api';
import { building } from '@/test/fixtures';
import { pickOption } from '@/test/render';
import { calendarEvent, calendarItems, holidays, settings } from './test-fixtures';
import { capPerDay, DAY_LIMIT } from './calendar-page';
import { renderV2 } from './test-render';
import type { CalendarItem } from './types';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

/* eslint-disable @typescript-eslint/no-explicit-any -- the stub stands in for FullCalendar's typed props */
const fc = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  api: {
    prev: vi.fn(),
    next: vi.fn(),
    today: vi.fn(),
    gotoDate: vi.fn(),
    changeView: vi.fn(),
    refetchEvents: vi.fn(),
    getDate: () => new Date(2026, 9, 7),
  },
}));

vi.mock('@fullcalendar/react', async () => {
  const React = await import('react');
  const Stub = React.forwardRef(function Stub(props: Record<string, any>, ref) {
    fc.props = props;
    React.useImperativeHandle(ref, () => ({ getApi: () => fc.api }));
    React.useEffect(() => {
      // FullCalendar reports the visible range once it has drawn the first view.
      (props['datesSet'] as (a: unknown) => void)({
        start: new Date(2026, 8, 28),
        end: new Date(2026, 10, 9),
        view: { type: 'dayGridMonth', currentStart: new Date(2026, 9, 1) },
      });
    }, []);
    return null;
  });
  return { default: Stub };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  for (const f of Object.values(fc.api))
    if (typeof f === 'function' && 'mockClear' in f) f.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/staff/settings': settings(),
    'GET /api/staff/holidays': { items: holidays },
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/owners': { items: [], nextCursor: null },
    'GET /api/staff/calendar': { items: calendarItems() },
    'GET /api/staff/calendar-events/evt-1': calendarEvent,
    'PATCH /api/staff/calendar-events/evt-1': (c: ApiCall) => ({
      ...calendarEvent,
      ...(c.body as object),
    }),
    'POST /api/staff/calendar-events': (c: ApiCall) => ({ id: 'evt-2', ...(c.body as object) }),
    ...extra,
  };
}

const item = (kind: CalendarItem['kind']): CalendarItem => {
  const found = calendarItems().find((i) => i.kind === kind);
  if (!found) throw new Error(kind);
  return found;
};

function dropArg(it: CalendarItem, start: Date | null, end: Date | null, allDay: boolean) {
  return {
    event: { extendedProps: { item: it }, start, end, allDay },
    revert: vi.fn(),
  };
}

describe('CalendarPage handlers', () => {
  it('titles each view, drives the toolbar and jumps to a month and year', async () => {
    const { user } = await renderV2('/calendar', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    act(() => {
      (fc.props['datesSet'] as (a: unknown) => void)({
        start: new Date(2026, 9, 5),
        end: new Date(2026, 9, 12),
        view: { type: 'timeGridWeek', currentStart: new Date(2026, 9, 5) },
      });
    });
    expect(screen.getByRole('heading', { name: '5 Oct 2026 – 11 Oct 2026' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Week', selected: true })).toBeTruthy();
    act(() => {
      (fc.props['datesSet'] as (a: unknown) => void)({
        start: new Date(2026, 0, 1),
        end: new Date(2027, 0, 1),
        view: { type: 'multiMonthYear', currentStart: new Date(2026, 0, 1) },
      });
    });
    expect(screen.getByRole('heading', { name: '2026' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(fc.api.prev).toHaveBeenCalledTimes(1);
    expect(fc.api.next).toHaveBeenCalledTimes(1);
    expect(fc.api.today).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(fc.api.changeView).toHaveBeenCalledWith('listMonth');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), '3');
    expect(fc.api.gotoDate).toHaveBeenLastCalledWith(new Date(2026, 2, 1));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2027');
    expect(fc.api.gotoDate).toHaveBeenLastCalledWith(new Date(2027, 9, 1));
  });

  it('shades holidays and weekends, and formats days, headers and the "more" link', async () => {
    await renderV2('/calendar', { routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    const cls = fc.props['dayCellClassNames'] as (a: { date: Date }) => string[];
    await vi.waitFor(() => {
      expect(cls({ date: new Date(2026, 11, 2) })).toEqual(['vc-holiday']);
    });
    expect(cls({ date: new Date(2026, 9, 10) })).toEqual(['vc-weekend']); // a Saturday
    expect(cls({ date: new Date(2026, 9, 12) })).toEqual([]);
    expect((fc.props['moreLinkContent'] as (a: { num: number }) => string)({ num: 4 })).toBe(
      '+4 more',
    );
    expect(
      (fc.props['dayHeaderContent'] as (a: { date: Date }) => string)({
        date: new Date(2026, 9, 12),
      }),
    ).toBe('Mon');
    expect(
      (fc.props['dayCellContent'] as (a: { date: Date }) => string)({ date: new Date(2026, 9, 7) }),
    ).toBe('7');
    expect(
      (fc.props['listDayFormat'] as (a: { date: { marker: Date } }) => string)({
        date: { marker: new Date(2026, 9, 7) },
      }),
    ).toBe('7 Oct 2026');
    expect(
      (fc.props['listDaySideFormat'] as (a: { date: { marker: Date } }) => string)({
        date: { marker: new Date(2026, 9, 7) },
      }),
    ).toBe('Wed');
    expect(fc.props['firstDay']).toBe(1); // Monday from the settings
  });

  it('feeds the items to the calendar: timed events at their time, the rest all day to the next day', async () => {
    await renderV2('/calendar', { routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    let events: Record<string, unknown>[] = [];
    await vi.waitFor(() => {
      (fc.props['events'] as (a: unknown, ok: (e: Record<string, unknown>[]) => void) => void)(
        {},
        (e) => {
          events = e;
        },
      );
      expect(events).toHaveLength(4);
    });
    const timed = events.find((e) => e['id'] === 'event:evt-1');
    expect(timed).toMatchObject({ start: '2026-10-15T10:00:00', allDay: false, editable: true });
    const cheque = events.find((e) => e['id'] === 'cheque:chq-1');
    expect(cheque).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-06',
      allDay: true,
      editable: false,
    });
  });

  it('opens the side panel for each kind with the right link, amount and actions', async () => {
    await renderV2('/calendar', { role: 'editor', routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    const click = (it: CalendarItem) => {
      act(() => {
        (fc.props['eventClick'] as (a: unknown) => void)({
          jsEvent: { preventDefault: vi.fn() },
          event: { extendedProps: { item: it } },
        });
      });
    };
    click(item('cheque_due'));
    const cheque = screen.getByRole('region', { name: 'Cheque 000101 · Al Noor Tower 801' });
    expect(within(cheque).getByRole('link', { name: 'Open the cheque' }).getAttribute('href')).toBe(
      '/cheques/chq-1',
    );
    expect(within(cheque).getByText('AED 23,750')).toBeTruthy();
    click(item('hearing'));
    expect(screen.getByRole('link', { name: 'Open the case' }).getAttribute('href')).toBe(
      '/disputes/dsp-1',
    );
    click(item('holiday'));
    expect(screen.getByText('Public holiday')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open/ })).toBeNull();
    click({
      ...item('cheque_due'),
      kind: 'contract_end',
      entityType: 'contract',
      entityId: 'con-1',
      endDate: '2026-10-07',
    });
    expect(screen.getByRole('link', { name: 'Open the contract' }).getAttribute('href')).toBe(
      '/contracts/con-1',
    );
    click({
      ...item('cheque_due'),
      kind: 'work_order',
      entityType: 'work_order',
      entityId: 'wo-1',
      amountFils: null,
      status: null,
    });
    expect(screen.getByRole('link', { name: 'Open the work order' }).getAttribute('href')).toBe(
      '/work-orders/wo-1',
    );
    click(item('event'));
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeTruthy();
    expect(screen.getByText(/· 10:00/)).toBeTruthy();
  });

  it('moves a dropped manual event and reverts any other kind or a refused move', async () => {
    const { api } = await renderV2('/calendar', { role: 'editor', routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    const drop = fc.props['eventDrop'] as (a: ReturnType<typeof dropArg>) => void;

    const cheque = dropArg(item('cheque_due'), new Date(2026, 9, 6), null, true);
    act(() => {
      drop(cheque);
    });
    expect(cheque.revert).toHaveBeenCalledTimes(1);
    const noStart = dropArg(item('event'), null, null, false);
    act(() => {
      drop(noStart);
    });
    expect(noStart.revert).toHaveBeenCalledTimes(1);
    expect(api.to('PATCH', '/api/staff/calendar-events/evt-1')).toHaveLength(0);

    const start = new Date(2026, 9, 16, 10, 0);
    const end = new Date(2026, 9, 16, 11, 30);
    const timed = dropArg(item('event'), start, end, false);
    act(() => {
      drop(timed);
    });
    expect(await screen.findByText('Event moved.')).toBeTruthy();
    expect(api.last('PATCH', '/api/staff/calendar-events/evt-1').body).toEqual({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
    expect(timed.revert).not.toHaveBeenCalled();

    const allDay = dropArg(item('event'), new Date(2026, 9, 20), new Date(2026, 9, 21), true);
    act(() => {
      drop(allDay);
    });
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/calendar-events/evt-1').body).toEqual({
        startsAt: '2026-10-20T00:00:00+04:00',
        endsAt: '2026-10-20T23:59:59+04:00',
      });
    });
  });

  it('reverts a drop the API refuses', async () => {
    await renderV2('/calendar', {
      role: 'editor',
      routes: routes({ 'PATCH /api/staff/calendar-events/evt-1': apiError(500, 'internal') }),
    });
    await screen.findByRole('heading', { name: 'October 2026' });
    const refused = dropArg(item('event'), new Date(2026, 9, 17, 9, 0), null, false);
    act(() => {
      (fc.props['eventDrop'] as (a: ReturnType<typeof dropArg>) => void)(refused);
    });
    await vi.waitFor(() => {
      expect(refused.revert).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Event moved.')).toBeNull();
  });

  it('filters by building, retries after an error, and keeps editing away from viewers', async () => {
    let fail = true;
    const { api, user } = await renderV2('/calendar', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/calendar': () =>
          fail ? apiError(500, 'internal') : { items: calendarItems() },
      }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'New event' })).toBeNull();
    expect(fc.props['editable']).toBe(false);
    await pickOption(user, screen.getByRole('combobox', { name: 'Building' }), 'bld-1');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/calendar').query['buildingId']).toBe('bld-1');
    });
  });

  it('is right-to-left in Arabic with Arabic month titles and filters by owner', async () => {
    const { api, user } = await renderV2('/calendar', {
      lang: 'ar',
      routes: routes({
        'GET /api/staff/owners': {
          items: [
            {
              id: 'own-1',
              nameAr: 'أحمد المنصوري',
              nameEn: 'Ahmed Al Mansouri',
              phoneE164: '+971501234567',
            },
          ],
          nextCursor: null,
        },
      }),
    });
    expect(await screen.findByRole('heading', { name: 'أكتوبر 2026' })).toBeTruthy();
    expect(fc.props['direction']).toBe('rtl');
    expect(screen.getByRole('button', { name: 'السابق' })).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: /مالك|Owner/ }));
    await user.click(await screen.findByRole('option', { name: /أحمد المنصوري/ }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/calendar').query['ownerId']).toBe('own-1');
    });
  });

  it('keeps three items a busy day in the grids and opens the rest in the day list', async () => {
    const day = (d: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${d}-${String(i)}`,
        title: `Item ${String(i)}`,
        start: `${d}T${String(8 + i).padStart(2, '0')}:00:00`,
        allDay: false,
      }));
    const spanning = {
      id: 'span',
      title: 'Contract',
      start: '2026-10-05',
      end: '2026-10-09',
      allDay: true,
    };
    const capped = capPerDay(
      [...day('2026-10-05', 7), ...day('2026-10-06', 2), spanning],
      (n) => `+${String(n)} more`,
    );
    const on5 = capped.filter((e) => String(e.start).startsWith('2026-10-05') && e.id !== 'span');
    expect(on5.map((e) => e.title)).toEqual([
      'Item 0',
      'Item 1',
      'Item 2',
      `+${String(7 - DAY_LIMIT)} more`,
    ]);
    expect(on5.at(-1)?.extendedProps).toEqual({ moreDate: '2026-10-05' });
    expect(capped.filter((e) => String(e.start).startsWith('2026-10-06'))).toHaveLength(2);
    expect(capped.some((e) => e.id === 'span')).toBe(true);
    expect(capPerDay(day('2026-10-07', DAY_LIMIT), () => 'x')).toHaveLength(DAY_LIMIT);

    await renderV2('/calendar', { routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    act(() => {
      (fc.props['eventClick'] as (a: unknown) => void)({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { moreDate: '2026-10-05' } },
      });
    });
    expect(fc.api.changeView).toHaveBeenLastCalledWith('listDay', '2026-10-05');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('closes the side panel, and opens the editor of a clicked manual event', async () => {
    const { user } = await renderV2('/calendar', { role: 'editor', routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    act(() => {
      (fc.props['eventClick'] as (a: unknown) => void)({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { item: item('event') } },
      });
    });
    const panel = screen.getByRole('region', { name: 'Annual inspection' });
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Annual inspection' })).toBeNull();
    act(() => {
      (fc.props['eventClick'] as (a: unknown) => void)({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { item: item('event') } },
      });
    });
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByDisplayValue('Annual inspection')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('starts the week on the configured day and shows a hidden kind again', async () => {
    const { api, user } = await renderV2('/calendar', {
      routes: routes({ 'GET /api/staff/settings': settings({ weekStart: 'sunday' }) }),
    });
    await screen.findByRole('heading', { name: 'October 2026' });
    await vi.waitFor(() => {
      expect(fc.props['firstDay']).toBe(0);
    });
    const hearing = screen.getByRole('checkbox', { name: 'Hearing' });
    await user.click(hearing);
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/calendar').query['kinds']).not.toContain('hearing');
    });
    await user.click(hearing);
    // Every kind again: the first (unfiltered) answer comes back from the cache.
    expect(hearing).toHaveProperty('checked', true);
    await vi.waitFor(() => {
      let fed: Record<string, unknown>[] = [];
      (fc.props['events'] as (a: unknown, ok: (e: Record<string, unknown>[]) => void) => void)(
        {},
        (e) => {
          fed = e;
        },
      );
      expect(fed.some((e) => e['id'] === 'hearing:dsp-1')).toBe(true);
    });
    cleanup();
    await renderV2('/calendar', {
      routes: routes({ 'GET /api/staff/settings': settings({ weekStart: 'saturday' }) }),
    });
    await screen.findByRole('heading', { name: 'October 2026' });
    await vi.waitFor(() => {
      expect(fc.props['firstDay']).toBe(6);
    });
  });

  it('lets a viewer read a manual event without editing it', async () => {
    await renderV2('/calendar', { role: 'viewer', routes: routes() });
    await screen.findByRole('heading', { name: 'October 2026' });
    act(() => {
      (fc.props['eventClick'] as (a: unknown) => void)({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { item: item('event') } },
      });
    });
    expect(screen.getByRole('region', { name: 'Annual inspection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
  });

  it('saves an all-day event without a building, refuses an empty date, and closes on Escape', async () => {
    const { api, user } = await renderV2('/calendar', {
      role: 'editor',
      routes: routes({
        'GET /api/staff/calendar-events/evt-1': {
          ...calendarEvent,
          buildingId: null,
          allDay: true,
        },
      }),
    });
    await screen.findByRole('heading', { name: 'October 2026' });
    act(() => {
      (fc.props['eventClick'] as (a: unknown) => void)({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { item: item('event') } },
      });
    });
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByDisplayValue('Annual inspection');
    expect(within(dialog).getByLabelText(/^Building/)).toHaveProperty('value', '');
    expect(within(dialog).queryByLabelText(/^Starts/)).toBeNull();
    const date = within(dialog).getByLabelText(/^Date/);
    await user.clear(date);
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    await user.type(date, '22/10/2026{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.last('PATCH', '/api/staff/calendar-events/evt-1').body).toMatchObject({
        startsAt: '2026-10-22T00:00:00+04:00',
        endsAt: '2026-10-22T23:59:59+04:00',
        allDay: true,
        buildingId: null,
      });
    });
    await user.click(screen.getByRole('button', { name: 'New event' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('creates a timed event with every field, and shows the API error', async () => {
    let refuse = false;
    const { api, user } = await renderV2('/calendar', {
      role: 'editor',
      routes: routes({
        'POST /api/staff/calendar-events': (c: ApiCall) =>
          refuse ? apiError(500, 'internal') : { id: 'evt-2', ...(c.body as object) },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'New event' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Title \(Arabic\)/), 'اجتماع');
    await user.type(within(dialog).getByLabelText(/Title \(English\)/), 'Meeting');
    const date = within(dialog).getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, '20/10/2026{Enter}');
    const allDay = within(dialog).getByRole('checkbox', { name: 'All day' });
    if ((allDay as HTMLInputElement).checked) await user.click(allDay);
    const starts = within(dialog).getByLabelText(/^Starts/);
    await user.clear(starts);
    await user.type(starts, '09:30');
    const ends = within(dialog).getByLabelText(/^Ends/);
    await user.clear(ends);
    await user.type(ends, '10:15');
    await user.selectOptions(within(dialog).getByLabelText(/Event type/), 'meeting');
    await pickOption(user, within(dialog).getByLabelText(/^Building/), 'bld-1');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Owner can see this event' }));
    await user.type(within(dialog).getByLabelText(/Notes/), 'Bring the keys');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.last('POST', '/api/staff/calendar-events').body).toMatchObject({
      titleAr: 'اجتماع',
      titleEn: 'Meeting',
      startsAt: '2026-10-20T09:30:00+04:00',
      endsAt: '2026-10-20T10:15:00+04:00',
      allDay: false,
      type: 'meeting',
      buildingId: 'bld-1',
      notes: 'Bring the keys',
    });

    refuse = true;
    await user.click(screen.getByRole('button', { name: 'New event' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Title \(Arabic\)/), 'x');
    await user.type(within(dialog).getByLabelText(/Title \(English\)/), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});
