import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  budgetAlertKeyDate,
  budgetLevel,
  budgetLines,
  budgetPercent,
  budgetToDate,
  budgetYearPeriod,
  projectedFixedByCategory,
  thresholdReached,
  yearToDate,
  type BudgetRule,
} from './budgets.js';
import { dedupeKey } from './alerts.js';
import { notificationCopy, NOTIFICATION_TYPE_LABEL } from './i18n/notifications.js';
import { BUDGET_LEVEL_LABEL, BUDGET_TOTAL_LABEL } from './i18n/labels.js';
import { createBudgetSchema, budgetQuerySchema } from './schemas/budgets.js';

const AED = (n: number) => n * 100;

describe('thresholds', () => {
  it('reaches 80 % and 100 % at the exact fils, not one before', () => {
    const budget = AED(120_000);
    expect(thresholdReached(AED(95_999.99), budget)).toBeNull();
    expect(thresholdReached(AED(96_000), budget)).toBe(80);
    expect(thresholdReached(AED(119_999.99), budget)).toBe(80);
    expect(thresholdReached(AED(120_000), budget)).toBe(100);
    expect(thresholdReached(AED(500_000), budget)).toBe(100);
    expect(thresholdReached(0, budget)).toBeNull();
  });

  it('levels and percentages agree, rounded down and never capped', () => {
    expect(budgetLevel(AED(10), AED(100))).toBe('ok');
    expect(budgetLevel(AED(80), AED(100))).toBe('near');
    expect(budgetLevel(AED(100), AED(100))).toBe('over');
    expect(budgetPercent(7_999, 10_000)).toBe(79);
    expect(budgetPercent(AED(115), AED(100))).toBe(115);
    expect(budgetPercent(0, AED(100))).toBe(0);
  });

  it('refuses a budget of zero', () => {
    expect(() => budgetPercent(1, 0)).toThrow(RangeError);
    expect(() => thresholdReached(1, -5)).toThrow(RangeError);
  });

  it('a level never goes down as more is spent (property)', () => {
    const rank = { ok: 0, near: 1, over: 2 } as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 20_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (budget, actual, more) => {
          const a = budgetLevel(actual, budget);
          const b = budgetLevel(actual + more, budget);
          expect(rank[b]).toBeGreaterThanOrEqual(rank[a]);
          // The level and the whole percent tell the same story.
          const pct = budgetPercent(actual, budget);
          expect(a === 'over').toBe(pct >= 100);
          expect(a !== 'ok').toBe(pct >= 80);
        },
      ),
    );
  });
});

describe('year to date', () => {
  it('runs from 1 January to today, the whole year once over, nothing before it starts', () => {
    expect(yearToDate(2026, '2026-10-07')).toEqual({ from: '2026-01-01', to: '2026-10-07' });
    expect(yearToDate(2025, '2026-10-07')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(yearToDate(2027, '2026-10-07')).toBeNull();
    expect(yearToDate(2027, '2027-01-01')).toEqual({ from: '2027-01-01', to: '2027-01-01' });
  });

  it('prorates the budget by days, today included, half up', () => {
    // 1 January: one day of 365.
    expect(budgetToDate(36_500, 2026, '2026-01-01')).toBe(100);
    expect(budgetToDate(AED(365_000), 2026, '2026-12-31')).toBe(AED(365_000));
    expect(budgetToDate(AED(365_000), 2026, '2026-07-02')).toBe(AED(183_000));
    // 2028 has 366 days: 29 February is day 60.
    expect(budgetToDate(36_600, 2028, '2028-02-29')).toBe(6_000);
    expect(budgetToDate(AED(1_000), 2027, '2026-12-31')).toBe(0);
    expect(budgetToDate(AED(1_000), 2025, '2026-03-01')).toBe(AED(1_000));
    // Half up: 1 fils over 365 days is 0 on day 1, 1 from day 183.
    expect(budgetToDate(1, 2026, '2026-01-01')).toBe(0);
    expect(budgetToDate(1, 2026, '2026-07-02')).toBe(1);
  });

  it('never goes past the budget and grows day by day (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 364 }),
        (budget, day) => {
          const d = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
          const next = new Date(Date.UTC(2026, 0, 2 + day)).toISOString().slice(0, 10);
          const a = budgetToDate(budget, 2026, d as `${number}-${number}-${number}`);
          const b = budgetToDate(budget, 2026, next as `${number}-${number}-${number}`);
          expect(a).toBeLessThanOrEqual(b);
          expect(b).toBeLessThanOrEqual(budget);
        },
      ),
    );
  });

  it('only takes sensible years', () => {
    expect(budgetYearPeriod(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(() => budgetYearPeriod(1999)).toThrow(RangeError);
    expect(() => budgetYearPeriod(2026.5)).toThrow(RangeError);
  });
});

const rule = (over: Partial<BudgetRule> = {}): BudgetRule => ({
  id: 'r-salaries',
  categoryId: 'c-salaries',
  active: true,
  amountFils: AED(6_500),
  vatFils: AED(325),
  frequency: 'monthly',
  dayOfMonth: 25,
  startDate: '2025-01-01',
  endDate: null,
  ...over,
});

describe('projected fixed costs', () => {
  it('counts the building total of each due date after today, by category', () => {
    const p = projectedFixedByCategory(
      [
        rule(),
        rule({ id: 'r-dewa', categoryId: 'c-util', amountFils: AED(1_850), vatFils: 0 }),
        rule({
          id: 'r-ins',
          categoryId: 'c-ins',
          frequency: 'yearly',
          dayOfMonth: 1,
          startDate: '2024-03-01',
          amountFils: AED(9_000),
          vatFils: 0,
        }),
      ],
      2026,
      '2026-10-07',
    );
    // 25 Oct, Nov, Dec.
    expect(p.get('c-salaries')).toBe(3 * AED(6_825));
    expect(p.get('c-util')).toBe(3 * AED(1_850));
    // The insurance fell due on 1 March: already behind us.
    expect(p.has('c-ins')).toBe(false);
  });

  it('leaves out inactive and ended rules, past years and due dates already recorded', () => {
    expect(projectedFixedByCategory([rule({ active: false })], 2026, '2026-10-07').size).toBe(0);
    expect(
      projectedFixedByCategory([rule({ endDate: '2026-10-31' })], 2026, '2026-10-07').get(
        'c-salaries',
      ),
    ).toBe(AED(6_825));
    expect(projectedFixedByCategory([rule()], 2025, '2026-10-07').size).toBe(0);
    // A future year is projected in full.
    expect(projectedFixedByCategory([rule()], 2027, '2026-10-07').get('c-salaries')).toBe(
      12 * AED(6_825),
    );
    const recorded = new Set(['r-salaries|2026-10-25']);
    expect(projectedFixedByCategory([rule()], 2026, '2026-10-07', recorded).get('c-salaries')).toBe(
      2 * AED(6_825),
    );
  });

  it('due today is actual or a draft, never projected', () => {
    expect(projectedFixedByCategory([rule()], 2026, '2026-12-25').get('c-salaries') ?? 0).toBe(0);
  });
});

describe('budget lines', () => {
  const actuals = [
    { categoryId: 'c-maint', yearFils: AED(100_000), toDateFils: AED(97_000) },
    { categoryId: 'c-util', yearFils: AED(50_000), toDateFils: AED(50_000) },
    // Not budgeted on its own, still part of the total.
    { categoryId: 'c-legal', yearFils: AED(20_000), toDateFils: AED(20_000) },
  ];
  const projected = new Map([
    ['c-util', AED(15_000)],
    ['c-salaries', AED(20_475)],
  ]);
  const lines = budgetLines(
    [
      { id: 'b-total', categoryId: null, amountFils: AED(300_000) },
      { id: 'b-maint', categoryId: 'c-maint', amountFils: AED(120_000) },
      { id: 'b-util', categoryId: 'c-util', amountFils: AED(80_000) },
    ],
    actuals,
    projected,
    2026,
    '2026-10-07',
  );

  it('puts the categories first and the total last', () => {
    expect(lines.map((l) => l.budgetId)).toEqual(['b-maint', 'b-util', 'b-total']);
  });

  it('a category line counts its category; the total counts every category', () => {
    const [maint, util, total] = lines;
    expect(maint).toMatchObject({
      actualFils: AED(100_000),
      actualToDateFils: AED(97_000),
      projectedFils: 0,
      forecastFils: AED(100_000),
      percent: 83,
      level: 'near',
      forecastLevel: 'near',
    });
    expect(util).toMatchObject({
      actualFils: AED(50_000),
      projectedFils: AED(15_000),
      forecastFils: AED(65_000),
      percent: 62,
      forecastPercent: 81,
      level: 'ok',
      forecastLevel: 'near',
    });
    expect(total).toMatchObject({
      actualFils: AED(170_000),
      actualToDateFils: AED(167_000),
      projectedFils: AED(35_475),
      forecastFils: AED(205_475),
      level: 'ok',
    });
  });

  it('compares the actual to date with the budget for the days elapsed', () => {
    const maint = lines[0]!;
    // 7 October is day 280 of 365.
    expect(maint.budgetToDateFils).toBe(Math.round((AED(120_000) * 280) / 365));
    expect(maint.toDatePercent).toBe(budgetPercent(AED(97_000), maint.budgetToDateFils));
  });

  it('forecast = actual + projected on every line (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000_000 }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000_000 }), { minLength: 1, maxLength: 6 }),
        (spent, proj) => {
          const acts = spent.map((v, i) => ({ categoryId: `c${i}`, yearFils: v, toDateFils: v }));
          const pr = new Map(proj.map((v, i) => [`c${i}`, v]));
          const ls = budgetLines(
            [
              ...spent.map((_, i) => ({ id: `b${i}`, categoryId: `c${i}`, amountFils: 1_000 })),
              { id: 'bt', categoryId: null, amountFils: 1_000 },
            ],
            acts,
            pr,
            2026,
            '2026-06-30',
          );
          for (const l of ls) expect(l.forecastFils).toBe(l.actualFils + l.projectedFils);
          const total = ls[ls.length - 1]!;
          expect(total.actualFils).toBe(spent.reduce((a, v) => a + v, 0));
          expect(total.projectedFils).toBe(proj.reduce((a, v) => a + v, 0));
        },
      ),
    );
  });
});

describe('alerts', () => {
  it('one dedupe key per owner, line and threshold, whatever the day', () => {
    const k80 = dedupeKey('budget_threshold', 'o1', 'b1', budgetAlertKeyDate(2026, 80));
    const k100 = dedupeKey('budget_threshold', 'o1', 'b1', budgetAlertKeyDate(2026, 100));
    expect(k80).toBe('budget_threshold:o1:b1:2026-01-01');
    expect(k100).toBe('budget_threshold:o1:b1:2026-12-31');
    expect(k80).not.toBe(k100);
  });

  it('push copy in both languages, Western digits, the total named', () => {
    const base = {
      type: 'budget_threshold' as const,
      year: 2026,
      buildingName: 'Al Noor Tower',
      categoryName: 'Lifts (repairs)',
      actualFils: AED(13_020),
      budgetFils: AED(15_000),
    };
    expect(notificationCopy({ ...base, threshold: 80 }, 'en')).toEqual({
      title: '80% of a budget used',
      body: 'Lifts (repairs) at Al Noor Tower: AED 13,020 spent of the 2026 budget of AED 15,000 (86%).',
    });
    const ar = notificationCopy(
      {
        ...base,
        threshold: 100,
        buildingName: 'برج النور',
        categoryName: null,
        actualFils: AED(15_500),
      },
      'ar',
    );
    expect(ar.title).toBe('نفدت الميزانية');
    expect(ar.body).toContain('إجمالي المصروفات في برج النور');
    expect(ar.body).toContain('(103%)');
    expect(ar.body).not.toMatch(/[٠-٩]/);
    expect(NOTIFICATION_TYPE_LABEL.budget_threshold.ar).toBe('تنبيه الميزانية');
    expect(BUDGET_LEVEL_LABEL.near.en).toBe('80% or more used');
    expect(BUDGET_TOTAL_LABEL.en).toBe('All expenses');
  });
});

describe('schemas', () => {
  it('a budget needs a positive amount; no category means the total', () => {
    const ok = createBudgetSchema.parse({
      buildingId: '0190a5b2-7c3e-7000-8000-000000000001',
      year: 2027,
      amountFils: AED(300_000),
    });
    expect(ok.categoryId).toBeNull();
    expect(createBudgetSchema.safeParse({ ...ok, amountFils: 0 }).success).toBe(false);
    expect(createBudgetSchema.safeParse({ ...ok, year: 1990 }).success).toBe(false);
    expect(budgetQuerySchema.parse({ year: '2026' }).year).toBe(2026);
  });
});
