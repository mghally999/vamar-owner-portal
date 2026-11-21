/**
 * Calendar-date helpers. Business dates are plain `YYYY-MM-DD` strings in Asia/Dubai,
 * never JS Date objects, so there is no timezone drift between the API, the app and Postgres
 * `date` columns. Arithmetic is done in UTC on purpose: a plain date has no clock time.
 */

export type PlainDate = `${number}-${number}-${number}`;

export const DUBAI_TZ = 'Asia/Dubai';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function assertPlainDate(value: string): PlainDate {
  if (!isPlainDate(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  return value;
}

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function toParts(date: PlainDate): DateParts {
  // Index arithmetic instead of split('-').map(Number): every date sum (addDays, diffDays) runs
  // through here, and the split was the larger part of their cost.
  const a = date.indexOf('-', 1);
  const b = date.indexOf('-', a + 1);
  return {
    year: Number(date.slice(0, a)),
    month: Number(date.slice(a + 1, b)),
    day: Number(date.slice(b + 1)),
  };
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function fromParts(parts: DateParts): PlainDate {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}` as PlainDate;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Days since 1970-01-01 (UTC) for a plain date. Used for whole-day arithmetic. */
export function toEpochDays(date: PlainDate): number {
  const { year, month, day } = toParts(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function fromEpochDays(days: number): PlainDate {
  const d = new Date(days * 86_400_000);
  return fromParts({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromEpochDays(toEpochDays(date) + days);
}

/** `b - a` in whole days. Positive when b is after a. */
export function diffDays(a: PlainDate, b: PlainDate): number {
  return toEpochDays(b) - toEpochDays(a);
}

/**
 * Add calendar months, clamping the day to the last day of the target month.
 * 2026-01-31 + 1 = 2026-02-28, and the caller must always add from the original anchor
 * (not chain) so 2026-01-31 + 2 = 2026-03-31, not 03-28.
 */
export function addMonthsClamped(date: PlainDate, months: number): PlainDate {
  const { year, month, day } = toParts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  return fromParts({ year: targetYear, month: targetMonth, day: Math.min(day, maxDay) });
}

/** Lexicographic compare works for zero-padded ISO dates. */
export function compareDates(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBetweenInclusive(d: PlainDate, start: PlainDate, end: PlainDate): boolean {
  return d >= start && d <= end;
}

export function firstDayOfMonth(date: PlainDate): PlainDate {
  const { year, month } = toParts(date);
  return fromParts({ year, month, day: 1 });
}

export function lastDayOfMonth(date: PlainDate): PlainDate {
  const { year, month } = toParts(date);
  return fromParts({ year, month, day: daysInMonth(year, month) });
}

/** `YYYY-MM` key for grouping and month switchers. */
export function monthKey(date: PlainDate): string {
  return date.slice(0, 7);
}

export function monthRange(year: number, month: number): { start: PlainDate; end: PlainDate } {
  const start = fromParts({ year, month, day: 1 });
  return { start, end: lastDayOfMonth(start) };
}

/** The calendar date in Asia/Dubai for a given instant (defaults to now). */
export function todayInDubai(now: Date = new Date()): PlainDate {
  // en-CA yields YYYY-MM-DD
  return assertPlainDate(dubaiDateFormat().format(now));
}

/** Built once: creating an Intl formatter costs far more than using one, and this runs per request. */
let dubaiFormat: Intl.DateTimeFormat | undefined;
function dubaiDateFormat(): Intl.DateTimeFormat {
  dubaiFormat ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dubaiFormat;
}

export type Lang = 'ar' | 'en';

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
] as const;

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTHS_EN_LONG = [
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
] as const;

/**
 * Human date with Western digits in both languages.
 * ar: `15 أكتوبر 2026`, en: `15 Oct 2026`. Month names are fixed strings so the output does
 * not depend on the ICU data shipped with a given phone or browser.
 */
export function formatDate(date: PlainDate, lang: Lang): string {
  const { year, month, day } = toParts(date);
  const name = lang === 'ar' ? MONTHS_AR[month - 1] : MONTHS_EN[month - 1];
  return `${day} ${name} ${year}`;
}

/** Dubai's offset from UTC; the UAE has kept no daylight saving since 1970. */
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * The clock time of an instant in Dubai, `HH:MM` (24 h, Western digits), whatever the device's
 * time zone. Plain arithmetic: no Intl formatter to build, so it is cheap in long lists.
 */
export function dubaiTime(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + DUBAI_OFFSET_MS);
  return `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}`;
}

/** Date and clock time of an instant in Dubai: `7 Oct 2026 14:05` / `7 أكتوبر 2026 14:05`. */
export function formatDateTime(at: Date | string, lang: Lang, separator = ' '): string {
  const d = new Date(at);
  return `${formatDate(todayInDubai(d), lang)}${separator}${dubaiTime(d)}`;
}

/** Month heading for switchers: `أكتوبر 2026` / `October 2026`. */
export function formatMonth(date: PlainDate, lang: Lang): string {
  const { year, month } = toParts(date);
  const name = lang === 'ar' ? MONTHS_AR[month - 1] : MONTHS_EN_LONG[month - 1];
  return `${name} ${year}`;
}
