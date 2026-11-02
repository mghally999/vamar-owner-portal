import { describe, expect, it } from 'vitest';
import {
  CALENDAR_ITEM_KINDS,
  formatHijri,
  monthGrid,
  nonWorkingDay,
  weekDays,
  weekdayLabel,
  weekdayOrder,
} from './calendar.js';
import type { PlainDate } from './dates.js';
import { CALENDAR_ITEM_KIND_LABEL } from './i18n/labels.js';

const D = (s: string) => s as PlainDate;

describe('month grid', () => {
  it('pads with the neighbouring months so every row has seven days', () => {
    const rows = monthGrid(2026, 11); // 1 Nov 2026 is a Sunday
    expect(rows).toHaveLength(6);
    expect(rows[0]?.map((d) => d.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(rows[0]?.[5]?.inMonth).toBe(false);
    expect(rows[0]?.[6]?.inMonth).toBe(true);
    expect(rows[5]?.[0]?.date).toBe('2026-11-30');
    expect(rows[5]?.[1]?.inMonth).toBe(false);
    for (const row of rows) expect(row).toHaveLength(7);
  });
  it('a February starting on the week start fits four rows', () => {
    expect(monthGrid(2027, 2)).toHaveLength(4); // 1 Feb 2027 is a Monday
    expect(monthGrid(2027, 2, 'sunday')).toHaveLength(5);
    expect(monthGrid(2028, 2)).toHaveLength(5); // leap February
  });
  it('orders the weekdays from the configured start', () => {
    expect(weekdayOrder()).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder('saturday')).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(weekdayOrder('sunday')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekDays(D('2026-11-05'))).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });
  it('labels weekdays in both languages', () => {
    expect(weekdayLabel(D('2026-11-02'), 'ar')).toBe('الاثنين');
    expect(weekdayLabel(D('2026-11-02'), 'en')).toBe('Monday');
    expect(weekdayLabel(D('2026-11-06'), 'en', true)).toBe('Fri');
    expect(weekdayLabel(D('2026-11-06'), 'ar', true)).toBe('جمعة');
  });
});

describe('non-working days', () => {
  it('holidays win over weekends, weekends over working days', () => {
    const holidays = new Set(['2026-12-02', '2026-12-05']);
    expect(nonWorkingDay(D('2026-12-02'), holidays)).toBe('holiday'); // Wednesday
    expect(nonWorkingDay(D('2026-12-05'), holidays)).toBe('holiday'); // Saturday too
    expect(nonWorkingDay(D('2026-12-06'), holidays)).toBe('weekend');
    expect(nonWorkingDay(D('2026-12-07'), ['2026-12-02'])).toBeNull();
  });
});

describe('Hijri date', () => {
  it('renders the Umm al-Qura date with Western digits in both languages', () => {
    const en = formatHijri(D('2026-11-02'), 'en');
    const ar = formatHijri(D('2026-11-02'), 'ar');
    expect(en).toMatch(/1448/);
    expect(ar).toMatch(/1448/);
    expect(en).not.toMatch(/[٠-٩]/);
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(en).toMatch(/Jumada|Jumada I|Jumada II|Rabi|Rajab|Shaʻban|Sha/);
  });
  it('is empty when the calendar is not available', () => {
    const original = Intl.DateTimeFormat;
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function () {
      throw new RangeError('no calendar');
    };
    try {
      expect(formatHijri(D('2026-11-02'), 'en')).toBe('');
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = original;
    }
  });
});

describe('item kinds', () => {
  it('every kind has a colour label in both languages', () => {
    for (const k of CALENDAR_ITEM_KINDS) {
      expect(CALENDAR_ITEM_KIND_LABEL[k].ar).toBeTruthy();
      expect(CALENDAR_ITEM_KIND_LABEL[k].en).toBeTruthy();
    }
  });
});
