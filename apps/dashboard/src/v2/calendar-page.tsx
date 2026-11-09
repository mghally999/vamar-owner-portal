import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import multiMonthPlugin from '@fullcalendar/multimonth';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import type {
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
  EventSourceFuncArg,
} from '@fullcalendar/core';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useV2 } from './messages';
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

type View = 'multiMonthYear' | 'dayGridMonth' | 'timeGridWeek' | 'listMonth';

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

  const items = q.data ?? [];
  const events = useMemo(() => toEvents(items, lang), [items, lang]);
  const eventSource = useCallback(
    (_arg: EventSourceFuncArg, ok: (events: EventInput[]) => void) => {
      ok(events);
    },
    [events],
  );
  useEffect(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, [events]);

  const api = () => calendarRef.current?.getApi();
  const onDatesSet = (arg: DatesSetArg) => {
    const from = iso(arg.start);
    const to = addDaysIso(iso(arg.end), -1);
    setRange((r) => (r.from === from && r.to === to ? r : { from, to }));
    setTitle(viewTitle(arg, lang));
    setView(arg.view.type as View);
  };
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
                  aria-selected={view === v.id}
                  onClick={() => {
                    api()?.changeView(v.id);
                  }}
                  className={cx(
                    'h-9 rounded-sm px-3 text-[13px] font-medium',
                    view === v.id ? 'bg-primary text-on-primary' : 'text-ink hover:bg-sunken',
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
          <FullCalendar
            ref={calendarRef}
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              multiMonthPlugin,
              listPlugin,
              interactionPlugin,
            ]}
            initialView="dayGridMonth"
            initialDate={today}
            headerToolbar={false}
            direction={isRtl ? 'rtl' : 'ltr'}
            firstDay={firstDay}
            height="auto"
            dayMaxEvents={3}
            moreLinkContent={(arg) => t('calendar_more', { n: arg.num })}
            editable={canEdit}
            eventStartEditable={canEdit}
            eventDurationEditable={false}
            droppable={false}
            events={eventSource}
            datesSet={onDatesSet}
            multiMonthMaxColumns={3}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            dayHeaderContent={(arg) => WEEKDAY_SHORT[lang][arg.date.getDay()] ?? ''}
            dayCellContent={(arg) => String(arg.date.getDate())}
            listDayFormat={(arg) => formatDate(iso(arg.date.marker), lang)}
            listDaySideFormat={(arg) => WEEKDAY_SHORT[lang][arg.date.marker.getDay()] ?? ''}
            noEventsContent={t('calendar_empty')}
            dayCellClassNames={(arg) => {
              const d = iso(arg.date);
              const classes: string[] = [];
              if (holidaySet.has(d)) classes.push('vc-holiday');
              else if (isWeekend(d)) classes.push('vc-weekend');
              return classes;
            }}
            eventClick={(arg: EventClickArg) => {
              arg.jsEvent.preventDefault();
              const item = (arg.event.extendedProps as { item: CalendarItem }).item;
              setSelected(item);
            }}
            eventDrop={(arg: EventDropArg) => {
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
              void move
                .mutateAsync({
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
            }}
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
