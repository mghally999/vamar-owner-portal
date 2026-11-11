/**
 * Reporting periods (business rule, v2). A period is a pair of Asia/Dubai calendar dates
 * `[from, to]`, both inclusive. Presets are resolved against "today" in Dubai so every screen
 * reflects the current year by default; the comparison period has the same length and ends the
 * day before the period starts.
 */
import {
  addDays,
  addMonthsClamped,
  daysInMonth,
  diffDays,
  firstDayOfMonth,
  formatDate,
  formatMonth,
  fromParts,
  lastDayOfMonth,
  toParts,
  type Lang,
  type PlainDate,
} from './dates.js';

export const PERIOD_PRESETS = [
  'today',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'next_month',
  'last_3_months',
  'last_6_months',
  'next_6_months',
  'this_quarter',
  'this_year',
  'last_year',
  'next_12_months',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type ResolvablePreset = Exclude<PeriodPreset, 'custom'>;

export const WEEK_STARTS = ['monday', 'saturday', 'sunday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];
/** The UAE work week runs Monday to Friday since 2022. */
export const DEFAULT_WEEK_START: WeekStart = 'monday';

export interface Period {
  from: PlainDate;
  to: PlainDate;
}

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === 'string' && (PERIOD_PRESETS as readonly string[]).includes(value);
}

export function isWeekStart(value: unknown): value is WeekStart {
  return typeof value === 'string' && (WEEK_STARTS as readonly string[]).includes(value);
}

/** 0 = Sunday ... 6 = Saturday, like `Date.getUTCDay()`. */
export function weekdayOf(date: PlainDate): number {
  const { year, month, day } = toParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const WEEK_START_INDEX: Record<WeekStart, number> = { sunday: 0, monday: 1, saturday: 6 };

/**
 * Whether resolving this preset reads the week start: only the week presets do (a missing or
 * unknown preset falls back to a month). Lets a request skip loading settings it would not use.
 */
export function presetNeedsWeekStart(preset: string | undefined): boolean {
  return preset === 'this_week' || preset === 'last_week';
}

/** The first day of the week that contains `date`. */
export function startOfWeek(date: PlainDate, weekStart: WeekStart = DEFAULT_WEEK_START): PlainDate {
  const offset = (weekdayOf(date) - WEEK_START_INDEX[weekStart] + 7) % 7;
  return addDays(date, -offset);
}

/** Saturday and Sunday (the UAE weekend since 2022). */
export function isWeekend(date: PlainDate): boolean {
  const d = weekdayOf(date);
  return d === 0 || d === 6;
}

export function monthPeriod(year: number, month: number): Period {
  const from = fromParts({ year, month, day: 1 });
  return { from, to: lastDayOfMonth(from) };
}

export function yearPeriod(year: number): Period {
  return {
    from: fromParts({ year, month: 1, day: 1 }),
    to: fromParts({ year, month: 12, day: 31 }),
  };
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): Period {
  const month = (quarter - 1) * 3 + 1;
  const from = fromParts({ year, month, day: 1 });
  return { from, to: lastDayOfMonth(addMonthsClamped(from, 2)) };
}

/**
 * "Last N months" is the N calendar months ending with the current one, so the buckets are whole
 * months and today's month is always included; "next N months" starts on the 1st of next month.
 */
export function resolvePreset(
  preset: ResolvablePreset,
  today: PlainDate,
  weekStart: WeekStart = DEFAULT_WEEK_START,
): Period {
  const { year, month } = toParts(today);
  const thisMonth = firstDayOfMonth(today);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'this_week': {
      const from = startOfWeek(today, weekStart);
      return { from, to: addDays(from, 6) };
    }
    case 'last_week': {
      const from = addDays(startOfWeek(today, weekStart), -7);
      return { from, to: addDays(from, 6) };
    }
    case 'this_month':
      return monthPeriod(year, month);
    case 'last_month': {
      const d = addMonthsClamped(thisMonth, -1);
      return { from: d, to: lastDayOfMonth(d) };
    }
    case 'next_month': {
      const d = addMonthsClamped(thisMonth, 1);
      return { from: d, to: lastDayOfMonth(d) };
    }
    case 'last_3_months':
      return { from: addMonthsClamped(thisMonth, -2), to: lastDayOfMonth(today) };
    case 'last_6_months':
      return { from: addMonthsClamped(thisMonth, -5), to: lastDayOfMonth(today) };
    case 'next_6_months': {
      const from = addMonthsClamped(thisMonth, 1);
      return { from, to: lastDayOfMonth(addMonthsClamped(thisMonth, 6)) };
    }
    case 'this_quarter':
      return quarterPeriod(year, (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4);
    case 'this_year':
      return yearPeriod(year);
    case 'last_year':
      return yearPeriod(year - 1);
    case 'next_12_months': {
      const from = addMonthsClamped(thisMonth, 1);
      return { from, to: lastDayOfMonth(addMonthsClamped(thisMonth, 12)) };
    }
  }
}

export function periodDays(p: Period): number {
  return diffDays(p.from, p.to) + 1;
}

export function assertPeriod(p: Period): Period {
  if (p.to < p.from) throw new RangeError(`Period end ${p.to} is before its start ${p.from}`);
  return p;
}

/** Number of whole calendar months the period spans exactly, or null. */
export function wholeMonths(p: Period): number | null {
  const f = toParts(p.from);
  const t = toParts(p.to);
  if (f.day !== 1 || t.day !== daysInMonth(t.year, t.month)) return null;
  const n = (t.year - f.year) * 12 + (t.month - f.month) + 1;
  return n >= 1 ? n : null;
}

/**
 * The comparison period: the same number of days, ending the day before `from`. Whole calendar
 * months compare with the same number of whole months (last month against the month before,
 * a year against the previous year) so month ends do not drift.
 */
export function previousPeriod(p: Period): Period {
  assertPeriod(p);
  const months = wholeMonths(p);
  if (months !== null) {
    const from = addMonthsClamped(p.from, -months);
    return { from, to: lastDayOfMonth(addMonthsClamped(from, months - 1)) };
  }
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(periodDays(p) - 1)), to };
}

export interface MonthBucket {
  /** `YYYY-MM` */
  key: string;
  from: PlainDate;
  to: PlainDate;
}

export const MAX_MONTH_BUCKETS = 24;

/** The months a period touches, clipped to the period, at most `max` (the earliest are dropped). */
export function monthBuckets(p: Period, max = MAX_MONTH_BUCKETS): MonthBucket[] {
  assertPeriod(p);
  const out: MonthBucket[] = [];
  let cursor = firstDayOfMonth(p.from);
  while (cursor <= p.to) {
    const end = lastDayOfMonth(cursor);
    out.push({
      key: cursor.slice(0, 7),
      from: cursor < p.from ? p.from : cursor,
      to: end > p.to ? p.to : end,
    });
    cursor = addMonthsClamped(cursor, 1);
  }
  return out.length > max ? out.slice(out.length - max) : out;
}

export const PERIOD_PRESET_LABEL: Record<PeriodPreset, Record<Lang, string>> = {
  today: { ar: 'اليوم', en: 'Today' },
  this_week: { ar: 'هذا الأسبوع', en: 'This week' },
  last_week: { ar: 'الأسبوع الماضي', en: 'Last week' },
  this_month: { ar: 'هذا الشهر', en: 'This month' },
  last_month: { ar: 'الشهر الماضي', en: 'Last month' },
  next_month: { ar: 'الشهر القادم', en: 'Next month' },
  last_3_months: { ar: 'آخر 3 أشهر', en: 'Last 3 months' },
  last_6_months: { ar: 'آخر 6 أشهر', en: 'Last 6 months' },
  next_6_months: { ar: 'الأشهر الستة القادمة', en: 'Next 6 months' },
  this_quarter: { ar: 'هذا الربع', en: 'This quarter' },
  this_year: { ar: 'هذه السنة', en: 'This year' },
  last_year: { ar: 'السنة الماضية', en: 'Last year' },
  next_12_months: { ar: 'الاثنا عشر شهراً القادمة', en: 'Next 12 months' },
  custom: { ar: 'فترة مخصصة', en: 'Custom range' },
};

/** `أكتوبر 2026`, `2026`, or `1 أكتوبر 2026 – 15 نوفمبر 2026`. Western digits always. */
export function formatPeriod(p: Period, lang: Lang): string {
  const months = wholeMonths(p);
  if (months === 1) return formatMonth(p.from, lang);
  if (months === 12 && p.from.endsWith('-01-01')) return p.from.slice(0, 4);
  if (p.from === p.to) return formatDate(p.from, lang);
  return `${formatDate(p.from, lang)} – ${formatDate(p.to, lang)}`;
}

/** Whether every day of the period is after `today` (nothing in it is actual yet). */
export function isFuturePeriod(p: Period, today: PlainDate): boolean {
  return p.from > today;
}

/**
 * Resolve what a client sent: a preset, or `from`/`to` for a custom range. A preset wins over
 * dates; a missing or unknown preset without dates falls back to `fallback`. Dates are
 * expected to be validated already (zod `plainDateSchema`).
 */
export function resolvePeriodQuery(
  q: { preset?: string | undefined; from?: string | undefined; to?: string | undefined },
  today: PlainDate,
  options: { weekStart?: WeekStart | undefined; fallback?: ResolvablePreset | undefined } = {},
): { preset: PeriodPreset; period: Period } {
  const fallback = options.fallback ?? 'this_month';
  if (isPeriodPreset(q.preset) && q.preset !== 'custom') {
    return { preset: q.preset, period: resolvePreset(q.preset, today, options.weekStart) };
  }
  if (q.from !== undefined && q.to !== undefined) {
    return {
      preset: 'custom',
      period: assertPeriod({ from: q.from as PlainDate, to: q.to as PlainDate }),
    };
  }
  return { preset: fallback, period: resolvePreset(fallback, today, options.weekStart) };
}
