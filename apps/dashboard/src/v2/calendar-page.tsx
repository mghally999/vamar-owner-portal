import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import multiMonthPlugin from '@fullcalendar/multimonth';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import type {
  DatesSetArg,
  DayCellContentArg,
  DayHeaderContentArg,
  EventClickArg,
  EventDropArg,
  EventInput,
  EventSourceFuncArg,
  MoreLinkContentArg,
} from '@fullcalendar/core';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  CALENDAR_EVENT_TYPES,
  CALENDAR_EVENT_TYPE_LABEL,
  CALENDAR_ITEM_KINDS,
  formatDate,
  isWeekend,
  todayInDubai,
  WEEKDAY_SHORT,
  type CalendarEventType,
  type CalendarItem,
  type CalendarItemKind,
  type PlainDate,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useBuildings } from '@/lib/queries';
import { Dialog } from '@/ui/dialog';
import { OwnerPicker } from '@/ui/owner-picker';
import {
  Button,
  Card,
  Checkbox,
  cx,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import './calendar.css';
import { useV2, type V2MessageKey } from './messages';
import {
  useCalendar,
  useCalendarEvent,
  useCreateEvent,
  useDeleteEvent,
  useHolidays,
  useSettings,
  useUpdateEvent,
} from './queries';
import { DateWarning, RouteLink } from './shared';
import { DatePicker } from '@/ui/date-picker';

type View = 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'listMonth' | 'listDay';

const VIEWS: {
  id: View;
  key: 'calendar_view_year' | 'calendar_view_month' | 'calendar_view_week' | 'calendar_view_list';
}[] = [
  { id: 'multiMonthYear', key: 'calendar_view_year' },
  { id: 'dayGridMonth', key: 'calendar_view_month' },
  { id: 'timeGridWeek', key: 'calendar_view_week' },
  { id: 'listMonth', key: 'calendar_view_list' },
];

/** One colour per kind, from the status palette so both themes carry it (the label is always beside it). */
export const KIND_COLOR: Record<CalendarItemKind, string> = {
  cheque_due: 'var(--color-status-cleared)',
  contract_end: 'var(--color-status-bounced)',
  contract_renewal: 'var(--color-primary)',
  hearing: 'var(--color-danger)',
  work_order: 'var(--color-status-deposited)',
  holiday: 'var(--color-status-cancelled)',
  event: 'var(--color-status-upcoming)',
};

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function iso(d: Date): PlainDate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as PlainDate;
}

function addDaysIso(date: PlainDate, days: number): PlainDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(y, m - 1, d + days);
  return iso(next);
}

/** Items drawn per day in the month grid. */
export const DAY_LIMIT = 3;

/**
 * In the month grid a busy day keeps its first `DAY_LIMIT` items and gets one "+N more" entry that
 * opens the day in the list. Given every item, FullCalendar builds and measures each
 * hidden one to count them (2,000 items in a month froze the page for 1.5 s). Items spanning
 * several days are always kept; the week and list views get every item, the year view none
 * (see `dayCounts`).
 */
export function capPerDay(events: EventInput[], moreTitle: (n: number) => string): EventInput[] {
  const out: EventInput[] = [];
  const byDay = new Map<PlainDate, EventInput[]>();
  for (const e of events) {
    const day = String(e.start).slice(0, 10) as PlainDate;
    const spans = e.end !== undefined && String(e.end).slice(0, 10) > addDaysIso(day, 1);
    if (spans) {
      out.push(e);
      continue;
    }
    const list = byDay.get(day);
    if (list) list.push(e);
    else byDay.set(day, [e]);
  }
  for (const [day, list] of byDay) {
    if (list.length <= DAY_LIMIT) {
      out.push(...list);
      continue;
    }
    list.sort((a, b) =>
      String(a.start) === String(b.start)
        ? String(a.title).localeCompare(String(b.title))
        : String(a.start) < String(b.start)
          ? -1
          : 1,
    );
    out.push(...list.slice(0, DAY_LIMIT), {
      id: `more-${day}`,
      title: moreTitle(list.length - DAY_LIMIT),
      start: day,
      end: addDaysIso(day, 1),
      allDay: true,
      editable: false,
      classNames: ['vc-more'],
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: 'var(--color-ink-soft)',
      extendedProps: { moreDate: day },
    });
  }
  return out;
}

/** What the year view shows on a day: how many items it holds and the kind most of them are. */
export interface DayCount {
  n: number;
  kind: CalendarItemKind;
}

/**
 * The year view draws one count per day instead of the items: FullCalendar builds and measures
 * every event element even when a day only has room for a few, which with 2,000 items in a month
 * blocked the page for over a second. An item spanning several days counts on each of them.
 */
export function dayCounts(items: CalendarItem[]): Map<PlainDate, DayCount> {
  const perKind = new Map<PlainDate, Map<CalendarItemKind, number>>();
  for (const i of items) {
    // A guard against a bad end date turning one item into an endless loop; a year view is 366 days.
    for (let d = i.date, step = 0; d <= i.endDate && step < 400; d = addDaysIso(d, 1), step++) {
      let kinds = perKind.get(d);
      if (!kinds) perKind.set(d, (kinds = new Map<CalendarItemKind, number>()));
      kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
    }
  }
  const out = new Map<PlainDate, DayCount>();
  for (const [day, kinds] of perKind) {
    let n = 0;
    let top: CalendarItemKind = 'event';
    let topN = 0;
    // Ties go to the kind listed first, so the colour does not change between fetches.
    for (const k of CALENDAR_ITEM_KINDS) {
      const c = kinds.get(k) ?? 0;
      n += c;
      if (c > topN) {
        top = k;
        topN = c;
      }
    }
    out.set(day, { n, kind: top });
  }
  return out;
}

const PLURALS = {
  ar: new Intl.PluralRules('ar'),
  en: new Intl.PluralRules('en'),
};

/** "5 items" / "5 عناصر", with Western digits like the rest of the dashboard. */
export function dayCountLabel(
  n: number,
  lang: 'ar' | 'en',
  t: (key: V2MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const form = PLURALS[lang].select(n);
  const key: V2MessageKey =
    form === 'one' || form === 'two' || form === 'few' || form === 'many'
      ? `calendar_dayItems_${form}`
      : 'calendar_dayItems_other';
  return t(key, { n });
}

/** What the year view gets as events: none (see `dayCounts`). */
const NO_EVENTS: EventInput[] = [];
const NO_ITEMS: CalendarItem[] = [];
/**
 * The React wrapper hands every option to the calendar again on each render of the page, and the
 * calendar then redraws the whole view (0.2 s for the year). The options below never change
 * identity unless their content does, so a memoised wrapper skips renders that change nothing
 * (the title, the range and the loading state all re-render the page).
 */
const Calendar = memo(FullCalendar);
/** FullCalendar's own `createElement` (Preact), handed to content functions; React's in tests. */
type CreateElement = (
  tag: string,
  props: Record<string, unknown> | null,
  ...children: unknown[]
) => object;
const PLUGINS = [dayGridPlugin, timeGridPlugin, multiMonthPlugin, listPlugin, interactionPlugin];
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false } as const;

/** FullCalendar event records built from the API items; memoised per fetch. */
function toEvents(items: CalendarItem[], lang: 'ar' | 'en'): EventInput[] {
  return items.map((i) => {
    const timed = i.allDay === false && typeof i.time === 'string' && i.time !== '';
    const base: EventInput = {
      id: i.id,
      title: lang === 'ar' ? i.titleAr : i.titleEn,
      start: timed ? `${i.date}T${i.time ?? ''}:00` : i.date,
      allDay: !timed,
      editable: i.kind === 'event',
      backgroundColor: KIND_COLOR[i.kind],
      borderColor: KIND_COLOR[i.kind],
      textColor: '#ffffff',
      classNames: [`vc-${i.kind}`],
      extendedProps: { item: i },
    };
    return timed ? base : { ...base, end: addDaysIso(i.endDate, 1) };
  });
}

export function CalendarPage() {
  const { t, lang, pick, isRtl, date, money } = useV2Calendar();
  const auth = useAuth();
  const settings = useSettings();
  const calendarRef = useRef<FullCalendar>(null);
  const today = todayInDubai();
  const [view, setView] = useState<View>('dayGridMonth');
  const [title, setTitle] = useState('');
  const [range, setRange] = useState<{ from: PlainDate; to: PlainDate }>({
    from: `${today.slice(0, 7)}-01` as PlainDate,
    to: addDaysIso(`${today.slice(0, 7)}-01` as PlainDate, 41),
  });
  const [buildingId, setBuildingId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [kinds, setKinds] = useState<CalendarItemKind[]>([...CALENDAR_ITEM_KINDS]);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; date: PlainDate } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const buildings = useBuildings();
  const q = useCalendar({
    from: range.from,
    to: range.to,
    buildingId: buildingId || undefined,
    ownerId: ownerId || undefined,
    kinds: kinds.length === CALENDAR_ITEM_KINDS.length ? undefined : kinds,
  });
  const yearOf = Number(range.from.slice(0, 4));
  const holidays = useHolidays(yearOf);
  const holidaysNext = useHolidays(yearOf + 1);
  const holidaySet = useMemo(
    () => new Set([...(holidays.data ?? []), ...(holidaysNext.data ?? [])].map((h) => h.date)),
    [holidays.data, holidaysNext.data],
  );
  const move = useUpdateEvent();
  const canEdit = auth.hasRole('editor');
  const weekStart = settings.data?.weekStart ?? 'monday';
  const firstDay = weekStart === 'sunday' ? 0 : weekStart === 'saturday' ? 6 : 1;

  // A new range's items often come straight from the cache in the same click that switched the
  // view. Deferred, they let the new view draw first and the lists and counts follow in a later
  // task instead of making one long one.
  const items = useDeferredValue(q.data ?? NO_ITEMS);
  // Both lists are kept ready (a few milliseconds for thousands of items): FullCalendar asks for the
  // events of a new view before it reports the change, so the source must pick by the view asked
  // for, not by the last one drawn. The month grid gets the capped list, week and list every item.
  const allEvents = useMemo(() => toEvents(items, lang), [items, lang]);
  const monthEvents = useMemo(
    () => capPerDay(allEvents, (n) => t('calendar_more', { n })),
    [allEvents, t],
  );
  // Counted for every view so the day cell renderer does not change when the view does: a changed
  // renderer redraws the whole year a second time.
  const counts = useMemo(() => dayCounts(items), [items]);

  const api = useCallback(() => calendarRef.current?.getApi(), []);
  // The view a tab (or a day) asked for, set before FullCalendar fetches for it.
  const nextView = useRef<View>('dayGridMonth');
  // FullCalendar redraws everything when any option changes, so every option below keeps its
  // identity across renders of this page; the source reads the latest lists from a ref.
  const lists = useRef({ all: NO_EVENTS, month: NO_EVENTS });
  const listFor = useCallback(
    (v: View) =>
      v === 'multiMonthYear'
        ? NO_EVENTS
        : v === 'dayGridMonth'
          ? lists.current.month
          : lists.current.all,
    [],
  );
  const eventSource = useCallback(
    (_arg: EventSourceFuncArg, ok: (events: EventInput[]) => void) => {
      ok(listFor(nextView.current));
    },
    [listFor],
  );
  const goTo = useCallback(
    (to: View, date?: string) => {
      const before = listFor(nextView.current);
      nextView.current = to;
      const cal = api();
      if (!cal) return;
      if (date === undefined) cal.changeView(to);
      else cal.changeView(to, date);
      // A range inside the one already fetched (a day of the year or month, the week of a month)
      // keeps the previous view's events, so ask again when this view draws a different list.
      if (listFor(to) !== before) cal.refetchEvents();
    },
    [api, listFor],
  );
  const openDay = useCallback(
    (day: string) => {
      goTo('listDay', day);
    },
    [goTo],
  );
  useEffect(() => {
    lists.current = { all: allEvents, month: monthEvents };
    // The year view draws counts, not events, so new items need no fetch there.
    if (nextView.current !== 'multiMonthYear') api()?.refetchEvents();
  }, [allEvents, monthEvents, api]);

  const onDatesSet = useCallback(
    (arg: DatesSetArg) => {
      const from = iso(arg.start);
      const to = addDaysIso(iso(arg.end), -1);
      setRange((r) => (r.from === from && r.to === to ? r : { from, to }));
      setTitle(viewTitle(arg, lang));
      nextView.current = arg.view.type as View;
      setView(arg.view.type as View);
    },
    [lang],
  );
  const moreLinkContent = useCallback(
    (arg: MoreLinkContentArg) => t('calendar_more', { n: arg.num }),
    [t],
  );
  const dayHeaderContent = useCallback(
    (arg: DayHeaderContentArg) => WEEKDAY_SHORT[lang][arg.date.getDay()] ?? '',
    [lang],
  );
  // The count is built with the element factory FullCalendar passes in, so it is drawn together
  // with the calendar. Returned as JSX it would go through a React portal, and the first portal
  // makes the calendar re-measure the whole year synchronously (about 0.3 s on a slow laptop).
  const dayCellContent = useCallback(
    (arg: DayCellContentArg, h: CreateElement) => {
      const day = String(arg.date.getDate());
      const c = arg.view.type === 'multiMonthYear' ? counts.get(iso(arg.date)) : undefined;
      if (!c) return day;
      const label = dayCountLabel(c.n, lang, t);
      const date = iso(arg.date);
      return h(
        'span',
        { className: 'vc-day' },
        day,
        h(
          'button',
          {
            type: 'button',
            className: 'vc-count',
            'aria-label': label,
            title: label,
            onClick: (e: MouseEvent) => {
              // The number sits inside FullCalendar's day link; keep the click to ourselves.
              e.preventDefault();
              e.stopPropagation();
              openDay(date);
            },
          },
          h('span', {
            className: 'vc-count-dot',
            style: { background: KIND_COLOR[c.kind] },
            'aria-hidden': 'true',
          }),
          String(c.n),
        ),
      );
    },
    [counts, lang, t, openDay],
  );
  const listDayFormat = useCallback(
    (arg: { date: { marker: Date } }) => formatDate(iso(arg.date.marker), lang),
    [lang],
  );
  const listDaySideFormat = useCallback(
    (arg: { date: { marker: Date } }) => WEEKDAY_SHORT[lang][arg.date.marker.getDay()] ?? '',
    [lang],
  );
  const dayCellClassNames = useCallback(
    (arg: DayCellContentArg) => {
      const d = iso(arg.date);
      const classes: string[] = [];
      if (holidaySet.has(d)) classes.push('vc-holiday');
      else if (isWeekend(d)) classes.push('vc-weekend');
      return classes;
    },
    [holidaySet],
  );
  const eventClick = useCallback(
    (arg: EventClickArg) => {
      arg.jsEvent.preventDefault();
      const props = arg.event.extendedProps as { item?: CalendarItem; moreDate?: string };
      if (props.moreDate) {
        openDay(props.moreDate);
        return;
      }
      if (props.item) setSelected(props.item);
    },
    [openDay],
  );
  const moveEvent = move.mutateAsync;
  const eventDrop = useCallback(
    (arg: EventDropArg) => {
      const item = (arg.event.extendedProps as { item: CalendarItem }).item;
      if (item.kind !== 'event' || !arg.event.start) {
        arg.revert();
        return;
      }
      const start = arg.event.start;
      const end = arg.event.end ?? arg.event.start;
      const toIso = (d: Date, allDay: boolean) =>
        allDay ? `${iso(d)}T00:00:00+04:00` : new Date(d.getTime()).toISOString();
      const endsAt = arg.event.allDay
        ? `${addDaysIso(iso(end), -1)}T23:59:59+04:00`
        : toIso(end, false);
      void moveEvent({
        id: item.entityId,
        startsAt: toIso(start, arg.event.allDay),
        endsAt,
      })
        .then(() => {
          setNotice(t('calendar_moved'));
        })
        .catch(() => {
          arg.revert();
        });
    },
    [moveEvent, t],
  );
  const monthOf = api()?.getDate() ?? new Date();

  return (
    <Page>
      <PageHeader
        title={t('calendar_title')}
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing({ id: null, date: today });
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('calendar_newEvent')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}

      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('calendar_prev')}
              onClick={() => api()?.prev()}
            >
              {isRtl ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => api()?.today()}>
              {t('calendar_today')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('calendar_next')}
              onClick={() => api()?.next()}
            >
              {isRtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
            <h2 className="ms-3 text-heading font-semibold tnum" aria-live="polite">
              {title}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('calendar_month')}
              value={String(monthOf.getMonth() + 1)}
              onChange={(e) => {
                api()?.gotoDate(new Date(monthOf.getFullYear(), Number(e.target.value) - 1, 1));
              }}
              className="w-36"
            >
              {(lang === 'ar' ? MONTHS_AR : MONTHS_EN).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('calendar_year')}
              value={String(monthOf.getFullYear())}
              onChange={(e) => {
                api()?.gotoDate(new Date(Number(e.target.value), monthOf.getMonth(), 1));
              }}
              className="w-28"
            >
              {Array.from({ length: 7 }, (_, i) => Number(today.slice(0, 4)) - 3 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <div
              role="tablist"
              aria-label={t('calendar_view_month')}
              className="flex rounded-md border border-line-strong bg-elevated p-0.5"
            >
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id || (v.id === 'listMonth' && view === 'listDay')}
                  onClick={() => {
                    goTo(v.id);
                  }}
                  className={cx(
                    'h-9 rounded-sm px-3 text-[13px] font-medium',
                    view === v.id || (v.id === 'listMonth' && view === 'listDay')
                      ? 'bg-primary text-on-primary'
                      : 'text-ink hover:bg-sunken',
                  )}
                >
                  {t(v.key)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value);
            }}
            aria-label={t('building')}
            className="w-56"
          >
            <option value="">{t('all')}</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b.nameAr, b.nameEn)}
              </option>
            ))}
          </Select>
          <OwnerPicker
            value={ownerId}
            onChange={(id) => {
              setOwnerId(id);
            }}
            className="w-64"
          />
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <legend className="sr-only">{t('calendar_kinds')}</legend>
            {CALENDAR_ITEM_KINDS.map((k) => (
              <Checkbox
                key={k}
                label={
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ background: KIND_COLOR[k] }}
                      aria-hidden
                    />
                    {t(`kind_${k}`)}
                  </span>
                }
                checked={kinds.includes(k)}
                onChange={(e) => {
                  setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k));
                }}
              />
            ))}
          </fieldset>
        </div>
      </Card>

      {q.isError ? (
        <Card className="px-5 py-4 text-danger">
          {t('error_generic')}{' '}
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="vamar-calendar p-2 sm:p-4" aria-busy={q.isPending}>
          <Calendar
            ref={calendarRef}
            plugins={PLUGINS}
            initialView="dayGridMonth"
            initialDate={today}
            headerToolbar={false}
            direction={isRtl ? 'rtl' : 'ltr'}
            firstDay={firstDay}
            height="auto"
            dayMaxEvents={DAY_LIMIT + 1}
            moreLinkContent={moreLinkContent}
            editable={canEdit}
            eventStartEditable={canEdit}
            eventDurationEditable={false}
            droppable={false}
            events={eventSource}
            datesSet={onDatesSet}
            multiMonthMaxColumns={3}
            eventTimeFormat={TIME_FORMAT}
            slotLabelFormat={TIME_FORMAT}
            dayHeaderContent={dayHeaderContent}
            dayCellContent={dayCellContent}
            listDayFormat={listDayFormat}
            listDaySideFormat={listDaySideFormat}
            noEventsContent={t('calendar_empty')}
            dayCellClassNames={dayCellClassNames}
            eventClick={eventClick}
            eventDrop={eventDrop}
          />
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <h3 className="text-[13px] font-medium text-ink-soft">{t('calendar_legend')}</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-[15px]">
              {CALENDAR_ITEM_KINDS.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ background: KIND_COLOR[k] }}
                    aria-hidden
                  />
                  {t(`kind_${k}`)}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-sm bg-sunken" aria-hidden />{' '}
                {t('calendar_weekend')}
              </li>
            </ul>
            <p className="mt-3 text-[13px] text-ink-faint tnum">
              {t('calendar_items', { n: items.length })}
            </p>
          </Card>
          {selected ? (
            <ItemPanel
              item={selected}
              onClose={() => {
                setSelected(null);
              }}
              onEdit={
                canEdit
                  ? () => {
                      setEditing({ id: selected.entityId, date: selected.date });
                      setSelected(null);
                    }
                  : undefined
              }
              date={date}
              money={money}
            />
          ) : null}
        </aside>
      </div>

      {editing ? (
        <EventDialog
          eventId={editing.id}
          defaultDate={editing.date}
          defaultBuildingId={buildingId}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            setNotice(t('saved'));
          }}
        />
      ) : null}
    </Page>
  );
}

function useV2Calendar() {
  const v2 = useV2();
  return { ...v2, isRtl: v2.lang === 'ar' };
}

function viewTitle(arg: DatesSetArg, lang: 'ar' | 'en'): string {
  const months = lang === 'ar' ? MONTHS_AR : MONTHS_EN;
  const current = arg.view.currentStart;
  if (arg.view.type === 'multiMonthYear') return String(current.getFullYear());
  if (arg.view.type === 'listDay') return formatDate(iso(arg.start), lang);
  if (arg.view.type === 'timeGridWeek') {
    const end = new Date(arg.end.getTime() - 86_400_000);
    return `${formatDate(iso(arg.start), lang)} – ${formatDate(iso(end), lang)}`;
  }
  return `${months[current.getMonth()] ?? ''} ${current.getFullYear()}`;
}

function ItemPanel({
  item,
  onClose,
  onEdit,
  date,
  money,
}: {
  item: CalendarItem;
  onClose: () => void;
  onEdit: (() => void) | undefined;
  date: (d: string | null | undefined) => string;
  money: (f: number | null | undefined) => string;
}) {
  const { t, pick } = useV2();
  const del = useDeleteEvent();
  const link = (() => {
    switch (item.entityType) {
      case 'cheque':
        return {
          to: '/cheques/$chequeId',
          params: { chequeId: item.entityId },
          label: t('calendar_openCheque'),
        };
      case 'contract':
        return {
          to: '/contracts/$contractId',
          params: { contractId: item.entityId },
          label: t('calendar_openContract'),
        };
      case 'dispute':
        return {
          to: '/disputes/$disputeId',
          params: { disputeId: item.entityId },
          label: t('calendar_openDispute'),
        };
      case 'work_order':
        return {
          to: '/work-orders/$workOrderId',
          params: { workOrderId: item.entityId },
          label: t('calendar_openWorkOrder'),
        };
      default:
        return null;
    }
  })();
  return (
    <section className="card p-4" aria-label={pick(item.titleAr, item.titleEn)}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] text-ink-soft">
          <span
            className="inline-block size-3 rounded-full"
            style={{ background: KIND_COLOR[item.kind] }}
            aria-hidden
          />
          {t(`kind_${item.kind}`)}
        </p>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t('close')}>
          ×
        </Button>
      </div>
      <p className="mt-2 text-[15px] font-medium" dir="auto">
        {pick(item.titleAr, item.titleEn)}
      </p>
      <p className="mt-1 text-[13px] text-ink-soft tnum">
        {date(item.date)}
        {item.endDate !== item.date ? ` – ${date(item.endDate)}` : ''}
        {item.time ? ` · ${item.time}` : ''}
      </p>
      {item.amountFils !== null && item.amountFils !== undefined ? (
        <p className="mt-1 text-[15px]">
          <Money fils={item.amountFils} />
        </p>
      ) : null}
      {item.status ? <p className="mt-1 text-[13px] text-ink-soft">{item.status}</p> : null}
      {item.kind === 'holiday' ? (
        <p className="mt-2 text-[13px] text-ink-soft">{t('calendar_holiday')}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {link ? (
          <Button size="sm" variant="secondary" asChild>
            <RouteLink to={link.to} params={link.params}>
              {link.label}
            </RouteLink>
          </Button>
        ) : null}
        {item.kind === 'event' && onEdit ? (
          <>
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {t('calendar_editEvent')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={del.isPending}
              onClick={() => {
                if (window.confirm(t('calendar_deleteConfirm')))
                  void del.mutateAsync(item.entityId).then(onClose);
              }}
            >
              {t('calendar_deleteEvent')}
            </Button>
          </>
        ) : null}
      </div>
      {item.kind !== 'event' && item.kind !== 'holiday' ? (
        <p className="mt-3 text-[13px] text-ink-faint">{t('calendar_notDraggable')}</p>
      ) : null}
      <span className="sr-only">{money(null)}</span>
    </section>
  );
}

function EventDialog({
  eventId,
  defaultDate,
  defaultBuildingId,
  onClose,
  onSaved,
}: {
  eventId: string | null;
  defaultDate: PlainDate;
  defaultBuildingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, pick, lang } = useV2();
  const existing = useCalendarEvent(eventId);
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const buildings = useBuildings();
  const [loaded, setLoaded] = useState(eventId === null);
  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [day, setDay] = useState<string>(defaultDate);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [allDay, setAllDay] = useState(false);
  const [type, setType] = useState<CalendarEventType>('other');
  const [buildingId, setBuildingId] = useState(defaultBuildingId);
  const [visible, setVisible] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!existing.data || loaded) return;
    const e = existing.data;
    setTitleAr(e.titleAr);
    setTitleEn(e.titleEn);
    const start = new Date(e.startsAt);
    const dubai = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dubai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    const time = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dubai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    setDay(dubai(start));
    setStartTime(time(start));
    setEndTime(time(new Date(e.endsAt)));
    setAllDay(e.allDay);
    setType(e.type);
    setBuildingId(e.buildingId ?? '');
    setVisible(e.visibleToOwner);
    setNotes(e.notes);
    setLoaded(true);
  }, [existing.data, loaded]);

  const valid =
    titleAr.trim() !== '' &&
    titleEn.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    (allDay || startTime <= endTime);
  const pending = create.isPending || update.isPending;
  const error = create.isError || update.isError;

  async function submit() {
    const body = {
      titleAr: titleAr.trim(),
      titleEn: titleEn.trim(),
      startsAt: allDay ? `${day}T00:00:00+04:00` : `${day}T${startTime}:00+04:00`,
      endsAt: allDay ? `${day}T23:59:59+04:00` : `${day}T${endTime}:00+04:00`,
      allDay,
      type,
      buildingId: buildingId || null,
      visibleToOwner: visible,
      notes: notes.trim(),
    };
    if (eventId) await update.mutateAsync({ id: eventId, ...body });
    else await create.mutateAsync(body);
    onSaved();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={eventId ? t('calendar_editEvent') : t('calendar_newEvent')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            // A refused save shows its message from create.isError or update.isError.
            onClick={() => void submit().catch(() => undefined)}
            disabled={!valid || !loaded}
            loading={pending}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('calendar_titleAr')} required>
          <Input
            value={titleAr}
            onChange={(e) => {
              setTitleAr(e.target.value);
            }}
            dir="rtl"
          />
        </Field>
        <Field label={t('calendar_titleEn')} required>
          <Input
            value={titleEn}
            onChange={(e) => {
              setTitleEn(e.target.value);
            }}
            dir="ltr"
          />
        </Field>
        <Field label={t('date')} required>
          <DatePicker
            value={day as PlainDate | ''}
            onChange={(next) => {
              setDay(next ?? '');
            }}
            required
          />
          <DateWarning date={day} />
        </Field>
        <div className="flex items-end">
          <Checkbox
            label={t('calendar_allDay')}
            checked={allDay}
            onChange={(e) => {
              setAllDay(e.target.checked);
            }}
          />
        </div>
        {!allDay ? (
          <>
            <Field label={t('calendar_starts')} required>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                }}
                numeric
              />
            </Field>
            <Field label={t('calendar_ends')} required>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                }}
                numeric
              />
            </Field>
          </>
        ) : null}
        <Field label={t('calendar_eventType')} required>
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as CalendarEventType);
            }}
          >
            {CALENDAR_EVENT_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {CALENDAR_EVENT_TYPE_LABEL[ty][lang]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('building')}>
          <Select
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value);
            }}
          >
            <option value="">—</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b.nameAr, b.nameEn)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            label={t('calendar_visibleToOwner')}
            checked={visible}
            onChange={(e) => {
              setVisible(e.target.checked);
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <Field label={t('calendar_notes')}>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={2}
            />
          </Field>
        </div>
        {error ? (
          <p className="text-[13px] text-danger sm:col-span-2">{t('error_generic')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
