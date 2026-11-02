import { describe, expect, it } from 'vitest';
import type { PlainDate } from './dates.js';
import {
  formatPeriod,
  isFuturePeriod,
  isPeriodPreset,
  isWeekStart,
  isWeekend,
  monthBuckets,
  monthPeriod,
  PERIOD_PRESET_LABEL,
  PERIOD_PRESETS,
  periodDays,
  previousPeriod,
  quarterPeriod,
  resolvePeriodQuery,
  resolvePreset,
  startOfWeek,
  weekdayOf,
  wholeMonths,
  yearPeriod,
} from './periods.js';

const D = (s: string) => s as PlainDate;

describe('presets on an ordinary day (Monday 2 Nov 2026)', () => {
  const today = D('2026-11-02');
  it.each([
    ['today', '2026-11-02', '2026-11-02'],
    ['this_week', '2026-11-02', '2026-11-08'],
    ['last_week', '2026-10-26', '2026-11-01'],
    ['this_month', '2026-11-01', '2026-11-30'],
    ['last_month', '2026-10-01', '2026-10-31'],
    ['next_month', '2026-12-01', '2026-12-31'],
    ['last_3_months', '2026-09-01', '2026-11-30'],
    ['last_6_months', '2026-06-01', '2026-11-30'],
    ['next_6_months', '2026-12-01', '2027-05-31'],
    ['this_quarter', '2026-10-01', '2026-12-31'],
    ['this_year', '2026-01-01', '2026-12-31'],
    ['last_year', '2025-01-01', '2025-12-31'],
    ['next_12_months', '2026-12-01', '2027-11-30'],
  ] as const)('%s', (preset, from, to) => {
    expect(resolvePreset(preset, today)).toEqual({ from, to });
  });

  it('this week follows the configured week start', () => {
    expect(resolvePreset('this_week', today, 'saturday')).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
    });
    expect(resolvePreset('this_week', today, 'sunday')).toEqual({
      from: '2026-11-01',
      to: '2026-11-07',
    });
    expect(resolvePreset('last_week', today, 'sunday')).toEqual({
      from: '2026-10-25',
      to: '2026-10-31',
    });
  });
});

describe('presets on 1 January', () => {
  const today = D('2026-01-01'); // a Thursday
  it('cross the year boundary backwards', () => {
    expect(resolvePreset('last_month', today)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolvePreset('last_3_months', today)).toEqual({
      from: '2025-11-01',
      to: '2026-01-31',
    });
    expect(resolvePreset('last_6_months', today)).toEqual({
      from: '2025-08-01',
      to: '2026-01-31',
    });
    expect(resolvePreset('last_year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(resolvePreset('this_week', today)).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(resolvePreset('this_quarter', today)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(resolvePreset('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('presets on 31 December', () => {
  const today = D('2026-12-31');
  it('cross the year boundary forwards', () => {
    expect(resolvePreset('this_month', today)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(resolvePreset('next_month', today)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(resolvePreset('next_6_months', today)).toEqual({
      from: '2027-01-01',
      to: '2027-06-30',
    });
    expect(resolvePreset('next_12_months', today)).toEqual({
      from: '2027-01-01',
      to: '2027-12-31',
    });
    expect(resolvePreset('this_quarter', today)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(resolvePreset('today', today)).toEqual({ from: '2026-12-31', to: '2026-12-31' });
  });
});

describe('presets on 29 February', () => {
  const today = D('2028-02-29');
  it('keep month ends right', () => {
    expect(resolvePreset('this_month', today)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolvePreset('last_month', today)).toEqual({ from: '2028-01-01', to: '2028-01-31' });
    expect(resolvePreset('next_month', today)).toEqual({ from: '2028-03-01', to: '2028-03-31' });
    expect(resolvePreset('last_3_months', today)).toEqual({
      from: '2027-12-01',
      to: '2028-02-29',
    });
    expect(resolvePreset('next_12_months', today)).toEqual({
      from: '2028-03-01',
      to: '2029-02-28',
    });
  });
});

describe('previous period', () => {
  it('a month compares with the month before, whatever their lengths', () => {
    expect(previousPeriod(monthPeriod(2028, 3))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(previousPeriod(monthPeriod(2026, 3))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod(monthPeriod(2026, 1))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('a year compares with the previous year, a quarter with the previous quarter', () => {
    expect(previousPeriod(yearPeriod(2026))).toEqual(yearPeriod(2025));
    expect(previousPeriod(quarterPeriod(2026, 1))).toEqual(quarterPeriod(2025, 4));
  });
  it('a custom range compares with the same number of days just before it', () => {
    const p = { from: D('2026-11-05'), to: D('2026-11-14') };
    expect(periodDays(p)).toBe(10);
    expect(previousPeriod(p)).toEqual({ from: '2026-10-26', to: '2026-11-04' });
    expect(previousPeriod({ from: D('2026-03-01'), to: D('2026-03-01') })).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    });
  });
  it('refuses a period that ends before it starts', () => {
    expect(() => previousPeriod({ from: D('2026-11-05'), to: D('2026-11-04') })).toThrow(
      RangeError,
    );
  });
});

describe('whole months and month buckets', () => {
  it('detects whole calendar months', () => {
    expect(wholeMonths(monthPeriod(2026, 2))).toBe(1);
    expect(wholeMonths(yearPeriod(2026))).toBe(12);
    expect(wholeMonths({ from: D('2026-01-01'), to: D('2026-02-27') })).toBeNull();
    expect(wholeMonths({ from: D('2026-01-02'), to: D('2026-02-28') })).toBeNull();
    expect(wholeMonths({ from: D('2026-03-01'), to: D('2026-02-28') })).toBeNull();
  });
  it('clips the first and last bucket to the period', () => {
    expect(monthBuckets({ from: D('2026-01-15'), to: D('2026-03-10') })).toEqual([
      { key: '2026-01', from: '2026-01-15', to: '2026-01-31' },
      { key: '2026-02', from: '2026-02-01', to: '2026-02-28' },
      { key: '2026-03', from: '2026-03-01', to: '2026-03-10' },
    ]);
  });
  it('keeps the latest 24 months of a longer period', () => {
    const b = monthBuckets({ from: D('2024-01-01'), to: D('2026-12-31') });
    expect(b).toHaveLength(24);
    expect(b[0]?.key).toBe('2025-01');
    expect(b[23]?.key).toBe('2026-12');
    expect(monthBuckets({ from: D('2024-01-01'), to: D('2026-12-31') }, 3)).toHaveLength(3);
  });
});

describe('weeks and weekends', () => {
  it('knows the weekday and the UAE weekend', () => {
    expect(weekdayOf(D('2026-11-02'))).toBe(1);
    expect(weekdayOf(D('2026-11-01'))).toBe(0);
    expect(isWeekend(D('2026-10-31'))).toBe(true); // Saturday
    expect(isWeekend(D('2026-11-01'))).toBe(true); // Sunday
    expect(isWeekend(D('2026-11-06'))).toBe(false); // Friday
  });
  it('starts the week on the configured day', () => {
    expect(startOfWeek(D('2026-11-05'))).toBe('2026-11-02');
    expect(startOfWeek(D('2026-11-05'), 'saturday')).toBe('2026-10-31');
    expect(startOfWeek(D('2026-11-05'), 'sunday')).toBe('2026-11-01');
    expect(startOfWeek(D('2026-11-01'), 'sunday')).toBe('2026-11-01');
  });
});

describe('labels and formatting', () => {
  it('has a label for every preset in both languages', () => {
    for (const p of PERIOD_PRESETS) {
      expect(PERIOD_PRESET_LABEL[p].ar.length).toBeGreaterThan(0);
      expect(PERIOD_PRESET_LABEL[p].en.length).toBeGreaterThan(0);
    }
    expect(isPeriodPreset('this_year')).toBe(true);
    expect(isPeriodPreset('yesterday')).toBe(false);
    expect(isWeekStart('monday')).toBe(true);
    expect(isWeekStart('tuesday')).toBe(false);
  });
  it('formats a month, a year, a day and a range with Western digits', () => {
    expect(formatPeriod(monthPeriod(2026, 10), 'ar')).toBe('أكتوبر 2026');
    expect(formatPeriod(monthPeriod(2026, 10), 'en')).toBe('October 2026');
    expect(formatPeriod(yearPeriod(2026), 'ar')).toBe('2026');
    expect(formatPeriod({ from: D('2026-03-01'), to: D('2026-03-01') }, 'en')).toBe('1 Mar 2026');
    expect(formatPeriod({ from: D('2026-01-01'), to: D('2026-02-15') }, 'en')).toBe(
      '1 Jan 2026 – 15 Feb 2026',
    );
    expect(formatPeriod({ from: D('2026-01-01'), to: D('2026-02-15') }, 'ar')).toBe(
      '1 يناير 2026 – 15 فبراير 2026',
    );
  });
  it('knows a period entirely in the future', () => {
    expect(isFuturePeriod(monthPeriod(2026, 12), D('2026-11-02'))).toBe(true);
    expect(isFuturePeriod(monthPeriod(2026, 11), D('2026-11-02'))).toBe(false);
  });
});

describe('resolvePeriodQuery', () => {
  const today = D('2026-11-02');
  it('a preset wins, then a custom range, then the fallback', () => {
    expect(resolvePeriodQuery({ preset: 'this_year' }, today)).toEqual({
      preset: 'this_year',
      period: yearPeriod(2026),
    });
    expect(
      resolvePeriodQuery({ preset: 'this_year', from: '2026-01-01', to: '2026-01-31' }, today)
        .preset,
    ).toBe('this_year');
    expect(resolvePeriodQuery({ from: '2026-01-01', to: '2026-01-31' }, today)).toEqual({
      preset: 'custom',
      period: { from: '2026-01-01', to: '2026-01-31' },
    });
    expect(resolvePeriodQuery({ preset: 'custom' }, today)).toEqual({
      preset: 'this_month',
      period: monthPeriod(2026, 11),
    });
    expect(resolvePeriodQuery({}, today, { fallback: 'this_year' }).preset).toBe('this_year');
    expect(resolvePeriodQuery({ preset: 'this_week' }, today, { weekStart: 'sunday' })).toEqual({
      preset: 'this_week',
      period: { from: '2026-11-01', to: '2026-11-07' },
    });
    expect(() => resolvePeriodQuery({ from: '2026-02-01', to: '2026-01-31' }, today)).toThrow(
      RangeError,
    );
  });
});
