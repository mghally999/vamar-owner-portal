/**
 * Calendar support (v2): the kinds of items a calendar shows, month grids for the app's own
 * calendar views, weekend and holiday checks, and the optional Hijri date.
 */
import { addDays, daysInMonth, fromParts, toParts, type Lang, type PlainDate } from './dates.js';
import {
  DEFAULT_WEEK_START,
  isWeekend,
  startOfWeek,
  weekdayOf,
  type WeekStart,
} from './periods.js';

/** Manual events staff put on the calendar. */
export const CALENDAR_EVENT_TYPES = [
  'inspection',
  'meeting',
  'handover',
  'reminder',
  'other',
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

/** Everything a calendar day can carry, computed and manual alike; each kind has its own colour. */
export const CALENDAR_ITEM_KINDS = [
  'cheque_due',
  'contract_end',
  'contract_renewal',
  'hearing',
  'work_order',
  'holiday',
  'event',
] as const;
export type CalendarItemKind = (typeof CALENDAR_ITEM_KINDS)[number];

export interface CalendarItem {
  kind: CalendarItemKind;
  id: string;
  date: PlainDate;
  /** Multi-day items (a holiday run, a scheduled job) end here; same as `date` otherwise. */
  endDate: PlainDate;
  titleAr: string;
  titleEn: string;
  /** Where a tap goes: the entity behind the item. */
  entityType: 'cheque' | 'contract' | 'dispute' | 'work_order' | 'holiday' | 'calendar_event';
  entityId: string;
  amountFils?: number | null;
  status?: string | null;
  unitId?: string | null;
  buildingId?: string | null;
  allDay?: boolean;
  /** Clock time in Asia/Dubai, `HH:MM`, for timed events only. */
  time?: string | null;
}

/** 0 = Sunday ... 6 = Saturday, the order of the columns for a given week start. */
export function weekdayOrder(weekStart: WeekStart = DEFAULT_WEEK_START): number[] {
  const first = { sunday: 0, monday: 1, saturday: 6 }[weekStart];
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
}

/**
 * The weeks of a month as rows of seven dates, padded with the neighbouring months' days so the
 * grid is always rectangular (5 or 6 rows). `inMonth` marks the month's own days.
 */
export function monthGrid(
  year: number,
  month: number,
  weekStart: WeekStart = DEFAULT_WEEK_START,
): { date: PlainDate; inMonth: boolean }[][] {
  const first = fromParts({ year, month, day: 1 });
  const last = fromParts({ year, month, day: daysInMonth(year, month) });
  let cursor = startOfWeek(first, weekStart);
  const rows: { date: PlainDate; inMonth: boolean }[][] = [];
  while (cursor <= last) {
    const row: { date: PlainDate; inMonth: boolean }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(cursor, i);
      row.push({ date: d, inMonth: d >= first && d <= last });
    }
    rows.push(row);
    cursor = addDays(cursor, 7);
  }
  return rows;
}

/** The seven days of the week containing `date`. */
export function weekDays(date: PlainDate, weekStart: WeekStart = DEFAULT_WEEK_START): PlainDate[] {
  const first = startOfWeek(date, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export const WEEKDAY_LABEL: Record<Lang, readonly string[]> = {
  // Sunday first, like weekdayOf().
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

export const WEEKDAY_SHORT: Record<Lang, readonly string[]> = {
  ar: ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export function weekdayLabel(date: PlainDate, lang: Lang, short = false): string {
  const table = short ? WEEKDAY_SHORT[lang] : WEEKDAY_LABEL[lang];
  return table[weekdayOf(date)] ?? '';
}

export type NonWorkingDay = 'weekend' | 'holiday';

/** Why a date is not a working day, or null. Holidays win over weekends in the label. */
export function nonWorkingDay(
  date: PlainDate,
  holidays: ReadonlySet<string> | readonly string[],
): NonWorkingDay | null {
  const set = holidays instanceof Set ? holidays : new Set(holidays);
  if (set.has(date)) return 'holiday';
  return isWeekend(date) ? 'weekend' : null;
}

/**
 * The Hijri (Umm al-Qura) date for display next to the Gregorian one, Western digits in both
 * languages: `12 ربيع الآخر 1448` / `12 Rabiʻ II 1448`. Empty when the runtime has no Islamic
 * calendar data, so a missing locale never breaks a screen.
 */
export function formatHijri(date: PlainDate, lang: Lang): string {
  try {
    const { year, month, day } = toParts(date);
    const fmt = new Intl.DateTimeFormat(
      lang === 'ar' ? 'ar-AE-u-ca-islamic-umalqura-nu-latn' : 'en-GB-u-ca-islamic-umalqura-nu-latn',
      { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' },
    );
    return fmt
      .format(new Date(Date.UTC(year, month - 1, day, 12)))
      .replace(/[‎‏؜]/g, '')
      .replace(/\s*AH$/i, '')
      .replace(/\s*هـ$/, '')
      .trim();
  } catch {
    return '';
  }
}

/** Re-exported here so calendar callers need one import. */
export { isWeekend, startOfWeek, weekdayOf };
