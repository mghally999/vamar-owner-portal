/**
 * The longest ranges the API accepts, mirrored from packages/shared/src/schemas/v2.ts: that
 * module builds zod schemas, which the app does not load (see shared.ts). A range past them is
 * refused with 422, so the app stops it before asking. period-limits.test.ts keeps the copies equal.
 */
import { diffDays, type PlainDate } from './shared';

/** Summary, expenses and cheques: `to - from` must stay under this many days. */
export const MAX_PERIOD_DAYS = 366 * 5;

/** The calendar endpoint: `to - from` at most this many days. */
export const MAX_CALENDAR_RANGE_DAYS = 400;

/** Why a custom range cannot be used, or null when it can. */
export function customRangeProblem(
  from: PlainDate,
  to: PlainDate,
): 'invalid_order' | 'too_long' | null {
  if (to < from) return 'invalid_order';
  if (diffDays(from, to) >= MAX_PERIOD_DAYS) return 'too_long';
  return null;
}

/** A period too long for the calendar endpoint to answer in one request. */
export function tooLongForCalendar(from: PlainDate, to: PlainDate): boolean {
  return diffDays(from, to) > MAX_CALENDAR_RANGE_DAYS;
}
