/**
 * Where the calendar's arrows take its cursor. A year is twelve months through the clamping
 * month step, so 29 Feb 2028 moves to 28 Feb 2029, not to a date that does not exist.
 */
import { addDays, addMonthsClamped, type PlainDate } from './shared';

export type CalendarView = 'year' | 'month' | 'week' | 'agenda';

export function moveCursor(view: CalendarView, cursor: PlainDate, dir: -1 | 1): PlainDate {
  switch (view) {
    case 'year':
      return addMonthsClamped(cursor, 12 * dir);
    case 'week':
      return addDays(cursor, 7 * dir);
    // The agenda shows sixty days from its cursor; the arrows page by that much.
    case 'agenda':
      return addDays(cursor, 60 * dir);
    case 'month':
      return addMonthsClamped(cursor, dir);
  }
}
