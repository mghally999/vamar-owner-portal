import { describe, expect, it } from 'vitest';
import { todayInDubai, yearPeriod } from '@vamar/shared';
import { isCompareOn, resolvePeriodSearch } from './period-search';

describe('resolvePeriodSearch', () => {
  const year = Number(todayInDubai().slice(0, 4));
  it('falls back to the given preset when the URL has nothing usable', () => {
    const r = resolvePeriodSearch({}, 'this_year');
    expect(r.preset).toBe('this_year');
    expect(r.period).toEqual(yearPeriod(year));
    expect(r.query).toEqual({ preset: 'this_year' });
    expect(r.compare).toBe(false);
    expect(r.comparison).toBeNull();
    expect(resolvePeriodSearch({ preset: 'yesterday' }, 'this_month').preset).toBe('this_month');
  });
  it('reads a preset, a custom range and the compare flag', () => {
    expect(resolvePeriodSearch({ preset: 'last_year' }, 'this_month').period).toEqual(
      yearPeriod(year - 1),
    );
    const custom = resolvePeriodSearch(
      { from: '2026-01-01', to: '2026-03-31', compare: '1' },
      'this_month',
    );
    expect(custom.preset).toBe('custom');
    expect(custom.query).toEqual({ from: '2026-01-01', to: '2026-03-31', compare: '1' });
    expect(custom.comparison).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    // a reversed or malformed range is ignored
    expect(resolvePeriodSearch({ from: '2026-03-31', to: '2026-01-01' }, 'this_month').preset).toBe(
      'this_month',
    );
    expect(resolvePeriodSearch({ from: '2026-02-30', to: '2026-03-01' }, 'this_month').preset).toBe(
      'this_month',
    );
  });
  it('accepts the compare flag in every spelling the URL may carry', () => {
    expect(isCompareOn('1')).toBe(true);
    expect(isCompareOn(1)).toBe(true);
    expect(isCompareOn(true)).toBe(true);
    expect(isCompareOn('true')).toBe(true);
    expect(isCompareOn('0')).toBe(false);
    expect(isCompareOn(undefined)).toBe(false);
  });
});
