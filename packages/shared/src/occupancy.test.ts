import { describe, expect, it } from 'vitest';
import { isUnitOccupiedOn, occupancyStats, vacantSince, type ContractWindow } from './occupancy.js';

const contracts: ContractWindow[] = [
  { unitId: 'u1', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' },
  { unitId: 'u2', status: 'expired', startDate: '2025-01-01', endDate: '2025-12-31' },
  { unitId: 'u3', status: 'draft', startDate: '2026-01-01', endDate: '2026-12-31' },
  { unitId: 'u4', status: 'active', startDate: '2026-10-08', endDate: '2027-10-07' },
  { unitId: 'u5', status: 'active', startDate: '2025-10-08', endDate: '2026-10-07' },
];

describe('isUnitOccupiedOn', () => {
  it('only active contracts count', () => {
    expect(isUnitOccupiedOn('u1', contracts, '2026-06-01')).toBe(true);
    expect(isUnitOccupiedOn('u2', contracts, '2025-06-01')).toBe(false); // expired status
    expect(isUnitOccupiedOn('u3', contracts, '2026-06-01')).toBe(false); // draft
    expect(isUnitOccupiedOn('u9', contracts, '2026-06-01')).toBe(false); // no contracts
  });

  it('edges: contract ends today counts, starts tomorrow does not', () => {
    const today = '2026-10-07';
    expect(isUnitOccupiedOn('u5', contracts, today)).toBe(true); // ends today
    expect(isUnitOccupiedOn('u4', contracts, today)).toBe(false); // starts tomorrow
    expect(isUnitOccupiedOn('u4', contracts, '2026-10-08')).toBe(true);
    expect(isUnitOccupiedOn('u5', contracts, '2026-10-08')).toBe(false);
  });
});

describe('occupancyStats', () => {
  it('counts occupied over all units the owner has any share in', () => {
    const s = occupancyStats(['u1', 'u2', 'u3', 'u4', 'u5'], contracts, '2026-10-07');
    expect(s).toEqual({ occupied: 2, total: 5, pct: 40, vacantUnitIds: ['u2', 'u3', 'u4'] });
  });

  it('dedupes unit ids and handles no units', () => {
    expect(occupancyStats(['u1', 'u1'], contracts, '2026-06-01')).toEqual({
      occupied: 1,
      total: 1,
      pct: 100,
      vacantUnitIds: [],
    });
    expect(occupancyStats([], contracts, '2026-06-01')).toEqual({
      occupied: 0,
      total: 0,
      pct: 0,
      vacantUnitIds: [],
    });
  });

  it('rounds the percentage to a whole number', () => {
    expect(occupancyStats(['u1', 'u2', 'u3'], contracts, '2026-06-01').pct).toBe(33);
  });
});

describe('vacantSince', () => {
  it('uses the latest ended contract, ignoring drafts', () => {
    expect(vacantSince('u2', contracts, '2026-10-07')).toEqual({
      kind: 'since',
      date: '2025-12-31',
    });
    expect(vacantSince('u3', contracts, '2026-10-07')).toEqual({ kind: 'never_rented' });
    expect(vacantSince('u9', contracts, '2026-10-07')).toEqual({ kind: 'never_rented' });
  });

  it('picks the most recent of several past contracts', () => {
    const many: ContractWindow[] = [
      { unitId: 'x', status: 'terminated', startDate: '2023-01-01', endDate: '2023-06-30' },
      { unitId: 'x', status: 'expired', startDate: '2024-01-01', endDate: '2024-12-31' },
      { unitId: 'x', status: 'renewed', startDate: '2022-01-01', endDate: '2022-12-31' },
    ];
    expect(vacantSince('x', many, '2026-01-01')).toEqual({ kind: 'since', date: '2024-12-31' });
  });

  it('a contract ending today is not yet "vacant since"', () => {
    expect(vacantSince('u5', contracts, '2026-10-07')).toEqual({ kind: 'never_rented' });
    expect(vacantSince('u5', contracts, '2026-10-08')).toEqual({
      kind: 'since',
      date: '2026-10-07',
    });
  });
});

describe('occupancyPct', () => {
  it('is a whole percent and never divides by zero', async () => {
    const { occupancyPct } = await import('./occupancy.js');
    expect(occupancyPct(0, 0)).toBe(0);
    expect(occupancyPct(1, 3)).toBe(33);
    expect(occupancyPct(2, 3)).toBe(67);
    expect(occupancyPct(5, 5)).toBe(100);
    expect(occupancyPct(7, 5)).toBe(100);
  });
});
