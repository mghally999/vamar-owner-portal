/**
 * Property tests: invariants that must hold for every input, not just the examples in the
 * per-module tests. Money never gains or loses a fils; dates round-trip; schedules stay ordered.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  compareDates,
  diffDays,
  fromEpochDays,
  toEpochDays,
  toParts,
  type PlainDate,
} from './dates.js';
import { formatNumber, parseAmountInput } from './money.js';
import { generateChequeSchedule, suggestEqualAmounts } from './schedule.js';
import { splitByShares, TOTAL_SHARE_BP, validateShares } from './shares.js';

// 2000-01-01 .. 2099-12-31
const date = fc
  .integer({
    min: toEpochDays('2000-01-01' as PlainDate),
    max: toEpochDays('2099-12-31' as PlainDate),
  })
  .map(fromEpochDays);
const fils = fc.integer({ min: 0, max: 100_000_000_00 });

/** 1..8 owners with distinct ids whose shares sum to exactly 100 %. */
const shares = fc.integer({ min: 1, max: 8 }).chain((n) =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: TOTAL_SHARE_BP - 1 }), {
      minLength: n - 1,
      maxLength: n - 1,
    })
    .map((cuts) => {
      const points = [0, ...cuts.sort((a, b) => a - b), TOTAL_SHARE_BP];
      return points.slice(1).map((p, i) => ({ ownerId: `owner-${i}`, shareBp: p - points[i]! }));
    }),
);

describe('money properties', () => {
  it('a split by shares adds up to the cheque and each part is within one fils', () => {
    fc.assert(
      fc.property(fils, shares, (amount, owners) => {
        expect(validateShares(owners).valid).toBe(true);
        const parts = splitByShares(amount, owners);
        expect(parts.reduce((s, p) => s + p.amountFils, 0)).toBe(amount);
        for (const p of parts) {
          const exact = (amount * p.shareBp) / TOTAL_SHARE_BP;
          expect(p.amountFils).toBeGreaterThanOrEqual(Math.floor(exact));
          expect(p.amountFils).toBeLessThanOrEqual(Math.floor(exact) + 1);
        }
      }),
    );
  });

  it('equal cheque amounts add up to the rent in whole dirhams', () => {
    fc.assert(
      fc.property(fils, fc.integer({ min: 1, max: 12 }), (rent, n) => {
        const amounts = suggestEqualAmounts(rent, n);
        expect(amounts).toHaveLength(n);
        expect(amounts.reduce((s, a) => s + a, 0)).toBe(rent);
        for (const a of amounts.slice(1)) expect(a % 100).toBe(0);
      }),
    );
  });

  it('a formatted amount parses back to the same fils', () => {
    fc.assert(
      fc.property(fils, fc.constantFrom('ar' as const, 'en' as const), (amount, lang) => {
        expect(parseAmountInput(formatNumber(amount, lang))).toBe(amount);
      }),
    );
  });
});

describe('date properties', () => {
  it('adding days round-trips through the day count', () => {
    fc.assert(
      fc.property(date, fc.integer({ min: -4000, max: 4000 }), (d, n) => {
        const moved = addDays(d, n);
        expect(diffDays(d, moved)).toBe(n);
        expect(addDays(moved, -n)).toBe(d);
        expect(fromEpochDays(toEpochDays(d))).toBe(d);
      }),
    );
  });

  it('adding months lands in the right month and never on a later day', () => {
    fc.assert(
      fc.property(date, fc.integer({ min: 0, max: 36 }), (d, m) => {
        const from = toParts(d);
        const to = toParts(addMonthsClamped(d, m));
        const months = from.year * 12 + (from.month - 1) + m;
        expect(to.year).toBe(Math.floor(months / 12));
        expect(to.month).toBe((months % 12) + 1);
        expect(to.day).toBeLessThanOrEqual(from.day);
      }),
    );
  });

  it('a cheque schedule starts on the start date and stays in order inside the contract', () => {
    fc.assert(
      fc.property(date, fc.integer({ min: 1, max: 12 }), (start, n) => {
        const end = addDays(addMonthsClamped(start, 12), -1);
        const schedule = generateChequeSchedule({ startDate: start, endDate: end, chequeCount: n });
        expect(schedule.map((c) => c.seq)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        expect(schedule[0]?.dueDate).toBe(start);
        for (let i = 1; i < schedule.length; i++) {
          expect(compareDates(schedule[i - 1]!.dueDate, schedule[i]!.dueDate)).toBe(-1);
        }
        for (const c of schedule) expect(compareDates(c.dueDate, end)).toBeLessThanOrEqual(0);
      }),
    );
  });
});
