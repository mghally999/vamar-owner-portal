/**
 * Owner statements: the monthly summary push names the month it summarises (so a late tap still
 * opens that month), and the years a yearly statement can be made for.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushData } from '../src/services/notifications.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

const KHALID = '+971500000001';

let w: TestWorld;

beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

describe('push data', () => {
  it('the monthly summary carries the first and last day of the month it summarises', () => {
    const october = pushData({
      type: 'monthly_summary',
      entityId: 'o1',
      params: {
        type: 'monthly_summary',
        month: '2026-10-01',
        collectedFils: 1,
        expensesFils: 0,
        netFils: 1,
      },
    });
    expect(october).toEqual({
      type: 'monthly_summary',
      entityId: 'o1',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const leapFebruary = pushData({
      type: 'monthly_summary',
      entityId: 'o1',
      params: {
        type: 'monthly_summary',
        month: '2028-02-01',
        collectedFils: 0,
        expensesFils: 0,
        netFils: 0,
      },
    });
    expect(leapFebruary).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('other notifications keep the type and the record only', () => {
    expect(
      pushData({
        type: 'cheque_bounced',
        entityId: 'q1',
        params: { type: 'cheque_bounced', amountFils: 100, unitLabel: 'Noor 101' },
      }),
    ).toEqual({ type: 'cheque_bounced', entityId: 'q1' });
  });
});

describe('statement years', () => {
  it('lists this year and the earlier years with data, newest first, never a future year', async () => {
    const token = await w.ownerToken(KHALID);
    const res = await w.json<{ years: number[] }>('/api/owner/statement-years', { token });
    expect(res.status).toBe(200);
    const { years } = res.body;
    const thisYear = Number(TODAY.slice(0, 4));
    expect(years[0]).toBe(thisYear);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(new Set(years).size).toBe(years.length);
    expect(years.every((y) => y <= thisYear)).toBe(true);
    // Every earlier year listed has rent or expenses in the summary for that year.
    for (const y of years.filter((y) => y !== thisYear)) {
      const s = await w.json<{
        rent: { expectedFils: number };
        expenses: { totalFils: number };
      }>(`/api/owner/summary?from=${String(y)}-01-01&to=${String(y)}-12-31`, { token });
      expect(s.status).toBe(200);
      expect(s.body.rent.expectedFils + s.body.expenses.totalFils).toBeGreaterThan(0);
    }
  });

  it('is for signed-in owners only', async () => {
    const res = await w.json('/api/owner/statement-years');
    expect(res.status).toBe(401);
  });
});
