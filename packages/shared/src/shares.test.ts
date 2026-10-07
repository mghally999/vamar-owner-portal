import { describe, expect, it } from 'vitest';
import { ownerShareAmount, splitByShares, validateShares } from './shares.js';

describe('validateShares', () => {
  it('requires exactly 10000 bp and unique owners', () => {
    expect(validateShares([{ ownerId: 'a', shareBp: 10_000 }]).valid).toBe(true);
    expect(
      validateShares([
        { ownerId: 'a', shareBp: 5_000 },
        { ownerId: 'b', shareBp: 5_000 },
      ]).valid,
    ).toBe(true);
    const short = validateShares([
      { ownerId: 'a', shareBp: 5_000 },
      { ownerId: 'b', shareBp: 4_999 },
    ]);
    expect(short.valid).toBe(false);
    expect(short.differenceBp).toBe(-1);
    const over = validateShares([
      { ownerId: 'a', shareBp: 6_000 },
      { ownerId: 'b', shareBp: 5_000 },
    ]);
    expect(over.valid).toBe(false);
    expect(over.differenceBp).toBe(1_000);
    const dup = validateShares([
      { ownerId: 'a', shareBp: 5_000 },
      { ownerId: 'a', shareBp: 5_000 },
    ]);
    expect(dup.valid).toBe(false);
    expect(dup.duplicateOwnerIds).toEqual(['a']);
    expect(validateShares([]).valid).toBe(false);
  });

  it('rejects out-of-range basis points', () => {
    expect(() => validateShares([{ ownerId: 'a', shareBp: 0 }])).toThrow(RangeError);
    expect(() => validateShares([{ ownerId: 'a', shareBp: 10_001 }])).toThrow(RangeError);
    expect(() => validateShares([{ ownerId: 'a', shareBp: 33.3 }])).toThrow(RangeError);
  });
});

describe('ownerShareAmount', () => {
  it('floors with integer math', () => {
    expect(ownerShareAmount(1_000_000, 5_000)).toBe(500_000);
    expect(ownerShareAmount(1_000_001, 5_000)).toBe(500_000);
    expect(ownerShareAmount(100, 3_333)).toBe(33);
    expect(ownerShareAmount(9_007_199_254_740_000, 10_000)).toBe(9_007_199_254_740_000); // no float overflow
  });
});

describe('splitByShares', () => {
  it('splits a cheque exactly, leftover to the largest shares', () => {
    const parts = splitByShares(100, [
      { ownerId: 'a', shareBp: 3_334 },
      { ownerId: 'b', shareBp: 3_333 },
      { ownerId: 'c', shareBp: 3_333 },
    ]);
    // floors: 33, 33, 33 => leftover 1 => goes to 'a' (largest)
    expect(parts).toEqual([
      { ownerId: 'a', shareBp: 3_334, amountFils: 34 },
      { ownerId: 'b', shareBp: 3_333, amountFils: 33 },
      { ownerId: 'c', shareBp: 3_333, amountFils: 33 },
    ]);
  });

  it('breaks ties by owner id ascending, deterministically', () => {
    const shares = [
      { ownerId: 'zed', shareBp: 3_333 },
      { ownerId: 'amy', shareBp: 3_333 },
      { ownerId: 'bob', shareBp: 3_334 },
    ];
    const parts = splitByShares(101, shares);
    // floors: 33, 33, 33 (bob: floor(101*0.3334)=33) => leftover 2 => bob (largest), then amy (tie, id order)
    expect(parts.find((p) => p.ownerId === 'bob')?.amountFils).toBe(34);
    expect(parts.find((p) => p.ownerId === 'amy')?.amountFils).toBe(34);
    expect(parts.find((p) => p.ownerId === 'zed')?.amountFils).toBe(33);
    // same input in a different order gives the same per-owner result
    const again = splitByShares(101, [...shares].reverse());
    for (const p of parts) {
      expect(again.find((q) => q.ownerId === p.ownerId)?.amountFils).toBe(p.amountFils);
    }
  });

  it('always sums exactly to the cheque amount across many random cases', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rand() * 6);
      // random partition of 10000
      const cuts = Array.from({ length: n - 1 }, () => 1 + Math.floor(rand() * 9_998)).sort(
        (a, b) => a - b,
      );
      const bps: number[] = [];
      let prev = 0;
      for (const c of [...cuts, 10_000]) {
        bps.push(c - prev);
        prev = c;
      }
      if (bps.some((b) => b < 1)) continue;
      const shares = bps.map((b, idx) => ({ ownerId: `o${idx}`, shareBp: b }));
      const amount = Math.floor(rand() * 5_000_000_00);
      const parts = splitByShares(amount, shares);
      expect(parts.reduce((acc, p) => acc + p.amountFils, 0)).toBe(amount);
      for (const p of parts)
        expect(p.amountFils).toBeGreaterThanOrEqual(ownerShareAmount(amount, p.shareBp));
    }
  });

  it('single owner gets everything; zero amount gives zeros', () => {
    expect(splitByShares(777, [{ ownerId: 'a', shareBp: 10_000 }])).toEqual([
      { ownerId: 'a', shareBp: 10_000, amountFils: 777 },
    ]);
    expect(
      splitByShares(0, [
        { ownerId: 'a', shareBp: 5_000 },
        { ownerId: 'b', shareBp: 5_000 },
      ]).map((p) => p.amountFils),
    ).toEqual([0, 0]);
  });

  it('rejects invalid shares and negative amounts', () => {
    expect(() => splitByShares(100, [{ ownerId: 'a', shareBp: 5_000 }])).toThrow(RangeError);
    expect(() => splitByShares(-1, [{ ownerId: 'a', shareBp: 10_000 }])).toThrow(RangeError);
    expect(() => splitByShares(1.5, [{ ownerId: 'a', shareBp: 10_000 }])).toThrow(RangeError);
  });
});
