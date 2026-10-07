import { describe, expect, it } from 'vitest';
import {
  generateChequeSchedule,
  suggestEqualAmounts,
  validateChequeGrid,
  type GridRow,
} from './schedule.js';

const dates = (rows: { dueDate: string }[]) => rows.map((r) => r.dueDate);

describe('generateChequeSchedule (12 divisible by n)', () => {
  it('1 cheque: start date only', () => {
    expect(
      dates(
        generateChequeSchedule({ startDate: '2026-03-15', endDate: '2027-03-14', chequeCount: 1 }),
      ),
    ).toEqual(['2026-03-15']);
  });

  it('4 cheques: quarterly from the anchor', () => {
    expect(
      dates(
        generateChequeSchedule({ startDate: '2026-03-15', endDate: '2027-03-14', chequeCount: 4 }),
      ),
    ).toEqual(['2026-03-15', '2026-06-15', '2026-09-15', '2026-12-15']);
  });

  it('12 cheques with a 31st anchor clamp in short months and return to the 31st', () => {
    const out = dates(
      generateChequeSchedule({ startDate: '2026-01-31', endDate: '2027-01-30', chequeCount: 12 }),
    );
    expect(out).toEqual([
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

  it('leap-year February', () => {
    const out = dates(
      generateChequeSchedule({ startDate: '2027-12-30', endDate: '2028-12-29', chequeCount: 6 }),
    );
    expect(out).toEqual([
      '2027-12-30',
      '2028-02-29',
      '2028-04-30',
      '2028-06-30',
      '2028-08-30',
      '2028-10-30',
    ]);
  });

  it('2 and 3 cheques', () => {
    expect(
      dates(
        generateChequeSchedule({ startDate: '2026-08-31', endDate: '2027-08-30', chequeCount: 2 }),
      ),
    ).toEqual(['2026-08-31', '2027-02-28']);
    expect(
      dates(
        generateChequeSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', chequeCount: 3 }),
      ),
    ).toEqual(['2026-01-01', '2026-05-01', '2026-09-01']);
  });

  it('assigns 1-based seq', () => {
    const out = generateChequeSchedule({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      chequeCount: 3,
    });
    expect(out.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});

describe('generateChequeSchedule (non-divisor counts spread by days)', () => {
  it('5 cheques over a 365-day year', () => {
    const out = dates(
      generateChequeSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', chequeCount: 5 }),
    );
    // offsets round(k*365/5) = 0, 73, 146, 219, 292
    expect(out).toEqual(['2026-01-01', '2026-03-15', '2026-05-27', '2026-08-08', '2026-10-20']);
  });

  it('7 cheques: first on start, all inside the period, strictly increasing', () => {
    const start = '2026-05-10';
    const end = '2027-05-09';
    const out = dates(generateChequeSchedule({ startDate: start, endDate: end, chequeCount: 7 }));
    expect(out[0]).toBe(start);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]! > out[i - 1]!).toBe(true);
      expect(out[i]! <= end).toBe(true);
    }
    expect(out).toHaveLength(7);
  });

  it.each([8, 9, 10, 11])('%i cheques are evenly spaced within one day', (n) => {
    const out = generateChequeSchedule({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      chequeCount: n,
    });
    const ideal = 365 / n;
    for (let i = 1; i < out.length; i++) {
      const gap = (Date.parse(out[i]!.dueDate) - Date.parse(out[i - 1]!.dueDate)) / 86_400_000;
      expect(Math.abs(gap - ideal)).toBeLessThanOrEqual(1);
    }
  });

  it('short contracts still produce distinct dates when possible', () => {
    const out = dates(
      generateChequeSchedule({ startDate: '2026-01-01', endDate: '2026-01-10', chequeCount: 5 }),
    );
    expect(out).toEqual(['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-07', '2026-01-09']);
  });
});

describe('generateChequeSchedule validation', () => {
  it('rejects bad counts and reversed dates', () => {
    expect(() =>
      generateChequeSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', chequeCount: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      generateChequeSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', chequeCount: 13 }),
    ).toThrow(RangeError);
    expect(() =>
      generateChequeSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', chequeCount: 2.5 }),
    ).toThrow(RangeError);
    expect(() =>
      generateChequeSchedule({ startDate: '2026-12-31', endDate: '2026-01-01', chequeCount: 4 }),
    ).toThrow(RangeError);
  });
});

describe('validateChequeGrid', () => {
  const row = (seq: number, amount: number | null, no: string | null = `00${seq}`): GridRow => ({
    seq,
    dueDate: '2026-01-01',
    amountFils: amount,
    chequeNo: no,
    bankName: 'ENBD',
  });

  it('reports a live total and completeness', () => {
    const v = validateChequeGrid([row(1, 5_000_000), row(2, null), row(3, 5_000_000)], 15_000_000);
    expect(v.totalFils).toBe(10_000_000);
    expect(v.differenceFils).toBe(-5_000_000);
    expect(v.complete).toBe(false);
    expect(v.missingSeqs).toEqual([2]);
    expect(v.matchesRent).toBe(false);
  });

  it('is complete and matching when everything is filled correctly', () => {
    const v = validateChequeGrid([row(1, 7_500_000), row(2, 7_500_000)], 15_000_000);
    expect(v.complete).toBe(true);
    expect(v.matchesRent).toBe(true);
    expect(v.differenceFils).toBe(0);
  });

  it('complete but mismatching total needs a reason downstream', () => {
    const v = validateChequeGrid([row(1, 7_500_000), row(2, 8_000_000)], 15_000_000);
    expect(v.complete).toBe(true);
    expect(v.matchesRent).toBe(false);
    expect(v.differenceFils).toBe(500_000);
  });

  it('flags duplicate cheque numbers and blank banks', () => {
    const v = validateChequeGrid(
      [row(1, 100, '7'), row(2, 100, '7'), { ...row(3, 100), bankName: ' ' }],
      300,
    );
    expect(v.duplicateChequeNos).toEqual(['7']);
    expect(v.missingSeqs).toEqual([3]);
    expect(v.complete).toBe(false);
  });
});

describe('suggestEqualAmounts', () => {
  it('splits exactly, remainder on the first cheque', () => {
    expect(suggestEqualAmounts(10_000_000, 4)).toEqual([
      2_500_000, 2_500_000, 2_500_000, 2_500_000,
    ]);
    const parts = suggestEqualAmounts(10_000_001, 3);
    expect(parts).toEqual([3_333_335, 3_333_333, 3_333_333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000_001);
  });
});
