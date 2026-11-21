/**
 * The Dubai calendar day of an instant from the API (a timestamptz, sent as UTC ISO text).
 * Slicing the text gives the UTC day, a day early for anything between 20:00 and midnight UTC.
 * Plain date columns (YYYY-MM-DD) are already days and need nothing.
 */
import { todayInDubai, type PlainDate } from './shared';

export function dubaiDay(iso: string): PlainDate {
  return todayInDubai(new Date(iso));
}
