import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PlainDate } from './dates.js';
import {
  allocateExpense,
  coveredPeriod,
  defaultAllocationMethod,
  expenseTotal,
  isExpenseOutlier,
  isLargeExpense,
  MANUAL_UNIT_STATUSES,
  nextDueDate,
  ownersOnDate,
  projectFixedExpenses,
  recurringDueDates,
  shareOnDate,
  splitByWeights,
  sumAllocations,
  vatFor,
  type AllocationUnit,
  type OwnershipRow,
} from './expenses.js';

const D = (s: string) => s as PlainDate;

describe('VAT and totals', () => {
  it('is 5 % rounded half up to the fils', () => {
    expect(vatFor(10_000)).toBe(500);
    expect(vatFor(12_345)).toBe(617); // 617.25
    expect(vatFor(12_350)).toBe(618); // 617.5 rounds up
    expect(vatFor(12_345, 0)).toBe(0);
    expect(expenseTotal(12_345, 617)).toBe(12_962);
    expect(() => vatFor(10.5)).toThrow(RangeError);
    expect(() => vatFor(100, 20_000)).toThrow(RangeError);
    expect(() => vatFor(100, -1)).toThrow(RangeError);
  });
  it('lists the statuses staff may set', () => {
    expect(MANUAL_UNIT_STATUSES).not.toContain('occupied');
    expect(MANUAL_UNIT_STATUSES).toContain('under_maintenance');
  });
});

describe('splitByWeights (largest remainder)', () => {
  it('splits exactly and gives the leftover to the largest remainders, ties by key', () => {
    expect(
      splitByWeights(100, [
        { key: 'a', weight: 1 },
        { key: 'b', weight: 1 },
        { key: 'c', weight: 1 },
      ]),
    ).toEqual([
      { key: 'a', amountFils: 34 },
      { key: 'b', amountFils: 33 },
      { key: 'c', amountFils: 33 },
    ]);
    // 100 * 850 / 2000 = 42.5, 100 * 1150 / 2000 = 57.5: the tie goes to the lower key.
    expect(
      splitByWeights(100, [
        { key: 'u2', weight: 1150 },
        { key: 'u1', weight: 850 },
      ]),
    ).toEqual([
      { key: 'u2', amountFils: 57 },
      { key: 'u1', amountFils: 43 },
    ]);
    expect(
      splitByWeights(10, [
        { key: 'a', weight: 0 },
        { key: 'b', weight: 3 },
      ]),
    ).toEqual([
      { key: 'a', amountFils: 0 },
      { key: 'b', amountFils: 10 },
    ]);
    expect(splitByWeights(0, [{ key: 'a', weight: 5 }])).toEqual([{ key: 'a', amountFils: 0 }]);
  });
  it('refuses bad input', () => {
    expect(() => splitByWeights(10, [])).toThrow(RangeError);
    expect(() => splitByWeights(-1, [{ key: 'a', weight: 1 }])).toThrow(RangeError);
    expect(() => splitByWeights(10, [{ key: 'a', weight: 0 }])).toThrow(RangeError);
    expect(() => splitByWeights(10, [{ key: 'a', weight: -1 }])).toThrow(RangeError);
    expect(() => splitByWeights(10, [{ key: 'a', weight: 1.5 }])).toThrow(RangeError);
    expect(() =>
      splitByWeights(10, [
        { key: 'a', weight: 1 },
        { key: 'a', weight: 1 },
      ]),
    ).toThrow(RangeError);
  });
  it('always adds up to the total, never goes negative, and stays within one fils of exact', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        fc.uniqueArray(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 6 }),
            weight: fc.integer({ min: 0, max: 1_000_000 }),
          }),
          { minLength: 1, maxLength: 25, selector: (x) => x.key },
        ),
        (total, items) => {
          fc.pre(items.some((i) => i.weight > 0));
          const parts = splitByWeights(total, items);
          const W = items.reduce((a, i) => a + i.weight, 0);
          expect(parts.reduce((a, p) => a + p.amountFils, 0)).toBe(total);
          for (const [i, p] of parts.entries()) {
            const exact = (total * (items[i]?.weight ?? 0)) / W;
            expect(p.amountFils).toBeGreaterThanOrEqual(0);
            expect(Math.abs(p.amountFils - exact)).toBeLessThan(1);
          }
          expect(splitByWeights(total, items)).toEqual(parts);
        },
      ),
      { numRuns: 500 },
    );
  });
});

const owners = (...shares: [string, number][]) =>
  shares.map(([ownerId, shareBp]) => ({ ownerId, shareBp }));

const building: AllocationUnit[] = [
  { unitId: 'u1', sizeSqft: 850, owners: owners(['k', 10_000]) },
  { unitId: 'u2', sizeSqft: 1150, owners: owners(['f', 6_000], ['o', 4_000]) },
  { unitId: 'u3', sizeSqft: 2000, owners: owners(['k', 5_000], ['o', 5_000]) },
];

describe('allocateExpense', () => {
  it('picks by_area when every unit has a size, otherwise equal units', () => {
    expect(defaultAllocationMethod(building)).toBe('by_area');
    expect(defaultAllocationMethod([{ sizeSqft: 100 }, { sizeSqft: null }])).toBe('equal_units');
    expect(defaultAllocationMethod([{ sizeSqft: 0 }])).toBe('equal_units');
    expect(defaultAllocationMethod([])).toBe('equal_units');
  });
  it('by_area: units by size, then owners by share (AED 4,000 = 400,000 fils)', () => {
    // sizes 850 / 1150 / 2000 of 4000: 85,000 / 115,000 / 200,000
    expect(allocateExpense(400_000, 'by_area', building)).toEqual([
      { unitId: 'u1', ownerId: 'k', amountFils: 85_000 },
      { unitId: 'u2', ownerId: 'f', amountFils: 69_000 },
      { unitId: 'u2', ownerId: 'o', amountFils: 46_000 },
      { unitId: 'u3', ownerId: 'k', amountFils: 100_000 },
      { unitId: 'u3', ownerId: 'o', amountFils: 100_000 },
    ]);
  });
  it('equal_units: a third each, the leftover fils to the first units', () => {
    const parts = allocateExpense(100, 'equal_units', building);
    expect(sumAllocations(parts)).toBe(100);
    expect(parts.find((p) => p.unitId === 'u1')?.amountFils).toBe(34);
  });
  it('by_ownership: every owner an equal part, spread over their units', () => {
    const parts = allocateExpense(300, 'by_ownership', building);
    expect(sumAllocations(parts)).toBe(300);
    const byOwner = new Map<string, number>();
    for (const p of parts) byOwner.set(p.ownerId, (byOwner.get(p.ownerId) ?? 0) + p.amountFils);
    expect([...byOwner.entries()].sort()).toEqual([
      ['f', 100],
      ['k', 100],
      ['o', 100],
    ]);
    // k holds u1 and u3: 50 each
    expect(parts.find((p) => p.unitId === 'u1' && p.ownerId === 'k')?.amountFils).toBe(50);
  });
  it('single_unit: just the unit, split by share', () => {
    expect(allocateExpense(1_001, 'single_unit', [building[1]!])).toEqual([
      { unitId: 'u2', ownerId: 'f', amountFils: 601 },
      { unitId: 'u2', ownerId: 'o', amountFils: 400 },
    ]);
    expect(() => allocateExpense(1, 'single_unit', building)).toThrow(RangeError);
  });
  it('refuses missing sizes, missing owners, duplicates and bad shares', () => {
    expect(() =>
      allocateExpense(1, 'by_area', [{ unitId: 'x', sizeSqft: null, owners: owners(['a', 1]) }]),
    ).toThrow(/by_area/);
    expect(() => allocateExpense(1, 'equal_units', [])).toThrow(RangeError);
    expect(() =>
      allocateExpense(1, 'equal_units', [{ unitId: 'x', sizeSqft: 1, owners: [] }]),
    ).toThrow(/no owners/);
    expect(() =>
      allocateExpense(1, 'equal_units', [
        { unitId: 'x', sizeSqft: 1, owners: owners(['a', 1]) },
        { unitId: 'x', sizeSqft: 1, owners: owners(['a', 1]) },
      ]),
    ).toThrow(/duplicate unit/);
    expect(() =>
      allocateExpense(1, 'equal_units', [
        { unitId: 'x', sizeSqft: 1, owners: owners(['a', 1], ['a', 2]) },
      ]),
    ).toThrow(/duplicate owner/);
    expect(() =>
      allocateExpense(1, 'equal_units', [{ unitId: 'x', sizeSqft: 1, owners: owners(['a', 0]) }]),
    ).toThrow(/shareBp/);
    expect(() => allocateExpense(-5, 'equal_units', building)).toThrow(RangeError);
    expect(() => sumAllocations([{ amountFils: 1.5 }])).toThrow(RangeError);
  });

  const unitArb = fc.record({
    unitId: fc.uuid(),
    sizeSqft: fc.integer({ min: 1, max: 20_000 }),
    owners: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 4 }).chain((ids) =>
      fc
        .array(fc.integer({ min: 1, max: 9_999 }), { minLength: ids.length, maxLength: ids.length })
        .map((weights) => {
          // shares that sum to exactly 10000 bp
          const bps = splitByWeights(
            10_000,
            ids.map((id, i) => ({ key: id, weight: weights[i] ?? 1 })),
          );
          return bps.map((b) => ({ ownerId: b.key, shareBp: Math.max(1, b.amountFils) }));
        }),
    ),
  });

  it('every method adds up to the total for any building (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000_000 }),
        fc.uniqueArray(unitArb, { minLength: 1, maxLength: 12, selector: (u) => u.unitId }),
        fc.constantFrom('by_area', 'equal_units', 'by_ownership'),
        (total, units, method) => {
          const parts = allocateExpense(total, method, units);
          expect(sumAllocations(parts)).toBe(total);
          for (const p of parts) {
            expect(p.amountFils).toBeGreaterThanOrEqual(0);
            const unit = units.find((u) => u.unitId === p.unitId);
            expect(unit?.owners.some((o) => o.ownerId === p.ownerId)).toBe(true);
          }
          const keys = parts.map((p) => `${p.unitId}|${p.ownerId}`);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('ownership on a date', () => {
  const rows: OwnershipRow[] = [
    {
      unitId: 'u',
      ownerId: 'a',
      shareBp: 10_000,
      fromDate: D('2022-01-01'),
      toDate: D('2026-06-01'),
    },
    { unitId: 'u', ownerId: 'a', shareBp: 6_000, fromDate: D('2026-06-01'), toDate: null },
    { unitId: 'u', ownerId: 'b', shareBp: 4_000, fromDate: D('2026-06-01'), toDate: null },
    { unitId: 'v', ownerId: 'c', shareBp: 10_000, fromDate: D('2022-01-01'), toDate: null },
  ];
  it('uses the set valid on the date; the change date belongs to the new owners', () => {
    expect(ownersOnDate(rows, 'u', D('2026-05-31'))).toEqual([{ ownerId: 'a', shareBp: 10_000 }]);
    expect(ownersOnDate(rows, 'u', D('2026-06-01'))).toEqual([
      { ownerId: 'a', shareBp: 6_000 },
      { ownerId: 'b', shareBp: 4_000 },
    ]);
    expect(ownersOnDate(rows, 'u', D('2021-12-31'))).toEqual([]);
    expect(shareOnDate(rows, 'u', 'b', D('2026-05-31'))).toBe(0);
    expect(shareOnDate(rows, 'u', 'b', D('2026-07-15'))).toBe(4_000);
    expect(shareOnDate(rows, 'v', 'c', D('2026-07-15'))).toBe(10_000);
  });
});

describe('recurring rules', () => {
  const year = { from: D('2026-01-01'), to: D('2026-12-31') };
  it('monthly on the 31st clamps to short months', () => {
    expect(
      recurringDueDates(
        { frequency: 'monthly', dayOfMonth: 31, startDate: D('2026-01-31'), endDate: null },
        year,
      ),
    ).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });
  it('quarterly and yearly step from the start month; the end date is inclusive', () => {
    expect(
      recurringDueDates(
        { frequency: 'quarterly', dayOfMonth: 15, startDate: D('2026-02-15'), endDate: null },
        year,
      ),
    ).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
    expect(
      recurringDueDates(
        {
          frequency: 'yearly',
          dayOfMonth: 1,
          startDate: D('2025-07-01'),
          endDate: D('2027-07-01'),
        },
        { from: D('2025-01-01'), to: D('2028-12-31') },
      ),
    ).toEqual(['2025-07-01', '2026-07-01', '2027-07-01']);
    expect(
      recurringDueDates(
        {
          frequency: 'monthly',
          dayOfMonth: 1,
          startDate: D('2026-01-01'),
          endDate: D('2026-03-01'),
        },
        year,
      ),
    ).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });
  it('starts next month when the day has already passed in the start month', () => {
    expect(
      recurringDueDates(
        { frequency: 'monthly', dayOfMonth: 5, startDate: D('2026-03-10'), endDate: null },
        { from: D('2026-03-01'), to: D('2026-05-31') },
      ),
    ).toEqual(['2026-04-05', '2026-05-05']);
    expect(
      recurringDueDates(
        { frequency: 'monthly', dayOfMonth: 1, startDate: D('2026-03-10'), endDate: null },
        { from: D('2026-01-01'), to: D('2026-02-28') },
      ),
    ).toEqual([]);
    expect(() =>
      recurringDueDates(
        { frequency: 'monthly', dayOfMonth: 0, startDate: D('2026-03-10'), endDate: null },
        year,
      ),
    ).toThrow(RangeError);
  });
  it('gives the same dates as walking every month from the start date', () => {
    // The reference walks from the rule's start, month by month; the real one skips to the period.
    const reference = (
      rule: Parameters<typeof recurringDueDates>[0],
      period: { from: PlainDate; to: PlainDate },
    ): string[] => {
      const step = { monthly: 1, quarterly: 3, yearly: 12 }[rule.frequency];
      const [sy, sm] = rule.startDate.split('-').map(Number) as [number, number];
      const dueIn = (index: number) => {
        const y = Math.floor(index / 12);
        const m = (index % 12) + 1;
        const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${y}-${pad(m)}-${pad(Math.min(rule.dayOfMonth, dim))}`;
      };
      let index = sy * 12 + sm - 1;
      if (dueIn(index) < rule.startDate) index += 1;
      const last = rule.endDate !== null && rule.endDate < period.to ? rule.endDate : period.to;
      const out: string[] = [];
      for (; dueIn(index) <= last; index += step)
        if (dueIn(index) >= period.from) out.push(dueIn(index));
      return out;
    };
    const day = fc
      .integer({ min: 0, max: 365 * 30 })
      .map(
        (n) =>
          new Date(Date.UTC(2005, 0, 1) + n * 86_400_000).toISOString().slice(0, 10) as PlainDate,
      );
    fc.assert(
      fc.property(
        fc.constantFrom('monthly', 'quarterly', 'yearly' as const),
        fc.integer({ min: 1, max: 31 }),
        day,
        fc.option(day, { nil: null }),
        day,
        fc.integer({ min: 0, max: 800 }),
        (frequency, dayOfMonth, startDate, endDate, from, length) => {
          const to = new Date(Date.parse(from) + length * 86_400_000)
            .toISOString()
            .slice(0, 10) as PlainDate;
          const rule = { frequency, dayOfMonth, startDate, endDate };
          expect(recurringDueDates(rule, { from, to })).toEqual(reference(rule, { from, to }));
        },
      ),
      { numRuns: 2000 },
    );
  });
  it('knows the covered period and the next due date', () => {
    expect(coveredPeriod(D('2026-02-28'), 'monthly')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(coveredPeriod(D('2026-11-15'), 'quarterly')).toEqual({
      from: '2026-11-01',
      to: '2027-01-31',
    });
    expect(coveredPeriod(D('2026-07-01'), 'yearly')).toEqual({
      from: '2026-07-01',
      to: '2027-06-30',
    });
    const rule = {
      frequency: 'monthly' as const,
      dayOfMonth: 25,
      startDate: D('2026-01-01'),
      endDate: null,
    };
    expect(nextDueDate(rule, D('2026-11-02'))).toBe('2026-11-25');
    expect(nextDueDate(rule, D('2026-11-25'))).toBe('2026-12-25');
    expect(nextDueDate({ ...rule, endDate: D('2026-11-25') }, D('2026-11-25'))).toBeNull();
  });
  it('projects only active rules and only future due dates', () => {
    const rules = [
      {
        id: 'salary',
        active: true,
        amountFils: 100_000,
        vatFils: 0,
        frequency: 'monthly' as const,
        dayOfMonth: 25,
        startDate: D('2026-01-01'),
        endDate: null,
      },
      {
        id: 'insurance',
        active: true,
        amountFils: 50_000,
        vatFils: 2_500,
        frequency: 'yearly' as const,
        dayOfMonth: 1,
        startDate: D('2026-12-01'),
        endDate: null,
      },
      {
        id: 'old',
        active: false,
        amountFils: 1,
        vatFils: 0,
        frequency: 'monthly' as const,
        dayOfMonth: 1,
        startDate: D('2026-01-01'),
        endDate: null,
      },
    ];
    expect(
      projectFixedExpenses(rules, { from: D('2026-11-01'), to: D('2026-12-31') }, D('2026-11-02')),
    ).toEqual([
      { ruleId: 'salary', dueDate: '2026-11-25', totalFils: 100_000 },
      { ruleId: 'insurance', dueDate: '2026-12-01', totalFils: 52_500 },
      { ruleId: 'salary', dueDate: '2026-12-25', totalFils: 100_000 },
    ]);
    // the 25th has passed: nothing is projected for November
    expect(
      projectFixedExpenses(rules, { from: D('2026-11-01'), to: D('2026-11-30') }, D('2026-11-25')),
    ).toEqual([]);
  });
});

describe('guards', () => {
  it('flags large expenses and outliers', () => {
    expect(isLargeExpense(500_000, 500_000)).toBe(true);
    expect(isLargeExpense(499_999, 500_000)).toBe(false);
    expect(isLargeExpense(1, 0)).toBe(false);
    expect(isExpenseOutlier(400, 100)).toBe(true);
    expect(isExpenseOutlier(300, 100)).toBe(false);
    expect(isExpenseOutlier(300, null)).toBe(false);
    expect(isExpenseOutlier(300, 0)).toBe(false);
  });
});
