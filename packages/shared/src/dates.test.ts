import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  assertPlainDate,
  compareDates,
  daysInMonth,
  diffDays,
  firstDayOfMonth,
  formatDate,
  formatMonth,
  fromEpochDays,
  isBetweenInclusive,
  isLeapYear,
  isPlainDate,
  lastDayOfMonth,
  monthKey,
  monthRange,
  toEpochDays,
  todayInDubai,
} from './dates.js';

describe('isPlainDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isPlainDate('2026-02-28')).toBe(true);
    expect(isPlainDate('2028-02-29')).toBe(true); // leap
    expect(isPlainDate('2026-02-29')).toBe(false);
    expect(isPlainDate('2026-04-31')).toBe(false);
    expect(isPlainDate('2026-13-01')).toBe(false);
    expect(isPlainDate('2026-1-1')).toBe(false);
    expect(isPlainDate('20260101')).toBe(false);
    expect(isPlainDate(20260101)).toBe(false);
    expect(() => assertPlainDate('2026-02-30')).toThrow(RangeError);
  });
});

describe('leap years and month lengths', () => {
  it('handles the 100/400 rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('day arithmetic', () => {
  it('adds and diffs whole days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(diffDays('2024-01-01', '2024-12-31')).toBe(365);
    expect(diffDays('2026-05-10', '2026-05-01')).toBe(-9);
    expect(fromEpochDays(toEpochDays('2026-10-07'))).toBe('2026-10-07');
  });
});

describe('addMonthsClamped', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-01-31', 3)).toBe('2026-04-30');
  });

  it('computes from the anchor, so the 31st comes back after February', () => {
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonthsClamped('2026-08-31', 7)).toBe('2027-03-31');
  });

  it('crosses year boundaries and accepts negative months', () => {
    expect(addMonthsClamped('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-11-15', 14)).toBe('2028-01-15');
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('comparisons and month helpers', () => {
  it('compares and ranges', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
    expect(isBetweenInclusive('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true);
    expect(isBetweenInclusive('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false);
    expect(firstDayOfMonth('2026-05-17')).toBe('2026-05-01');
    expect(lastDayOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(monthKey('2026-05-17')).toBe('2026-05');
    expect(monthRange(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('todayInDubai', () => {
  it('rolls to the next day at 20:00 UTC', () => {
    expect(todayInDubai(new Date('2026-10-07T19:59:59Z'))).toBe('2026-10-07');
    expect(todayInDubai(new Date('2026-10-07T20:00:00Z'))).toBe('2026-10-08');
    expect(todayInDubai(new Date('2026-12-31T20:30:00Z'))).toBe('2027-01-01');
  });
});

describe('formatting', () => {
  it('uses Western digits and fixed month names in both languages', () => {
    expect(formatDate('2026-10-15', 'ar')).toBe('15 أكتوبر 2026');
    expect(formatDate('2026-10-15', 'en')).toBe('15 Oct 2026');
    expect(formatDate('2026-01-05', 'en')).toBe('5 Jan 2026');
    expect(formatMonth('2026-10-15', 'ar')).toBe('أكتوبر 2026');
    expect(formatMonth('2026-10-15', 'en')).toBe('October 2026');
  });
});
