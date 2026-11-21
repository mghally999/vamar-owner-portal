import { describe, expect, it } from 'vitest';
import * as api from '@vamar/shared/schemas/v2';
import {
  MAX_CALENDAR_RANGE_DAYS,
  MAX_PERIOD_DAYS,
  customRangeProblem,
  tooLongForCalendar,
} from './period-limits';

describe('period limits', () => {
  it('match what the API accepts', () => {
    expect(MAX_PERIOD_DAYS).toBe(api.MAX_PERIOD_DAYS);
    expect(MAX_CALENDAR_RANGE_DAYS).toBe(api.MAX_CALENDAR_RANGE_DAYS);
  });

  it('refuses a custom range the API would refuse, and nothing else', () => {
    expect(customRangeProblem('2026-10-31', '2026-10-01')).toBe('invalid_order');
    expect(customRangeProblem('2026-10-01', '2026-10-01')).toBeNull();
    expect(customRangeProblem('2026-01-01', '2030-12-31')).toBeNull();
    // 1829 days apart is the last the API takes; 1830 is refused.
    expect(customRangeProblem('2020-01-01', '2025-01-03')).toBeNull();
    expect(customRangeProblem('2020-01-01', '2025-01-04')).toBe('too_long');
    expect(customRangeProblem('2010-01-01', '2026-12-31')).toBe('too_long');
    // The same edge, checked against the API's own schema.
    expect(api.periodQuerySchema.safeParse({ from: '2020-01-01', to: '2025-01-03' }).success).toBe(
      true,
    );
    expect(api.periodQuerySchema.safeParse({ from: '2020-01-01', to: '2025-01-04' }).success).toBe(
      false,
    );
  });

  it('knows a period the calendar cannot show in one request', () => {
    expect(tooLongForCalendar('2026-01-01', '2026-12-31')).toBe(false);
    expect(tooLongForCalendar('2026-01-01', '2027-02-05')).toBe(false);
    expect(tooLongForCalendar('2026-01-01', '2027-02-06')).toBe(true);
  });
});
