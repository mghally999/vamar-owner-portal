import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHEQUE_STATUSES } from './cheques.js';
import type { PlainDate } from './dates.js';
import { shareOnDate, type OwnershipRow } from './expenses.js';
import { changePct, netFils, projectedNetFils, summariseRent } from './rent.js';
import { ownerShareAmount } from './shares.js';

const D = (s: string) => s as PlainDate;

describe('summariseRent', () => {
  it('expected = collected + outstanding + at risk; replaced and cancelled never count', () => {
    const s = summariseRent([
      { status: 'upcoming', amountFils: 100 },
      { status: 'deposited', amountFils: 200 },
      { status: 'cleared', amountFils: 300 },
      { status: 'bounced', amountFils: 400 },
      { status: 'replaced', amountFils: 400 },
      { status: 'cancelled', amountFils: 999 },
    ]);
    expect(s).toEqual({
      expectedFils: 1000,
      collectedFils: 300,
      outstandingFils: 300,
      atRiskFils: 400,
      chequeCount: 4,
      bouncedCount: 1,
    });
    expect(s.collectedFils + s.outstandingFils + s.atRiskFils).toBe(s.expectedFils);
  });
  it('holds for any mix of cheques (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom(...CHEQUE_STATUSES),
            amountFils: fc.integer({ min: 0, max: 10_000_000 }),
          }),
          { maxLength: 40 },
        ),
        (items) => {
          const s = summariseRent(items);
          expect(s.collectedFils + s.outstandingFils + s.atRiskFils).toBe(s.expectedFils);
          expect(s.outstandingFils).toBe(
            items
              .filter((c) => c.status === 'upcoming' || c.status === 'deposited')
              .reduce((a, c) => a + c.amountFils, 0),
          );
          expect(s.expectedFils).toBe(
            items
              .filter((c) => c.status !== 'replaced' && c.status !== 'cancelled')
              .reduce((a, c) => a + c.amountFils, 0),
          );
        },
      ),
    );
  });
  it('refuses fractional fils', () => {
    expect(() => summariseRent([{ status: 'cleared', amountFils: 1.5 }])).toThrow(RangeError);
  });
});

describe('ownership changing in the middle of a period', () => {
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
  ];
  const cheques = [
    { dueDate: D('2026-05-15'), status: 'cleared' as const, amountFils: 100_000 },
    { dueDate: D('2026-07-15'), status: 'upcoming' as const, amountFils: 100_000 },
  ];
  const forOwner = (ownerId: string) =>
    cheques.flatMap((c) => {
      const share = shareOnDate(rows, 'u', ownerId, c.dueDate);
      return share === 0
        ? []
        : [{ status: c.status, amountFils: ownerShareAmount(c.amountFils, share) }];
    });
  it('splits each cheque by the share valid on its due date', () => {
    expect(summariseRent(forOwner('a'))).toMatchObject({
      expectedFils: 160_000,
      collectedFils: 100_000,
      outstandingFils: 60_000,
    });
    expect(summariseRent(forOwner('b'))).toMatchObject({
      expectedFils: 40_000,
      collectedFils: 0,
      outstandingFils: 40_000,
    });
    const a = summariseRent(forOwner('a'));
    const b = summariseRent(forOwner('b'));
    expect(a.expectedFils + b.expectedFils).toBe(200_000);
  });
});

describe('net and comparisons', () => {
  it('net is collected minus every posted expense; projected net ignores variable costs', () => {
    expect(netFils(1_000, { fixedFils: 300, variableFils: 200 })).toBe(500);
    expect(netFils(100, { fixedFils: 300, variableFils: 0 })).toBe(-200);
    expect(projectedNetFils(1_000, 300)).toBe(700);
    expect(() => netFils(1.5, { fixedFils: 0, variableFils: 0 })).toThrow(RangeError);
  });
  it('percent change is null against a zero comparison', () => {
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(50, 100)).toBe(-50);
    expect(changePct(1, 3)).toBe(-66.7);
    expect(changePct(-50, -100)).toBe(50);
    expect(changePct(10, 0)).toBeNull();
  });
});
