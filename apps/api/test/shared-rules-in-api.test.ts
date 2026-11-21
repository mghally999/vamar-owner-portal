/**
 * The API on the shared rules (shared/structure sweep items): the outlier check a year back from
 * 29 February, recurring drafts covering the shared period, one-pass unit holders with the
 * current-owner fallback, and the void route's body checked by the shared schema.
 */
import { eq, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { coveredPeriod, netFils, ownersOnDate, summariseRent, type PlainDate } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdersByUnit } from '../src/services/allocation-owners.js';
import { createRecurringDrafts, expenseWarnings } from '../src/services/expenses.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

describe('expense warnings', () => {
  it('work on 29 February (a year back is 28 February)', async () => {
    const [cat] = await w.db
      .select({ id: schema.expenseCategories.id })
      .from(schema.expenseCategories)
      .limit(1);
    const r = await expenseWarnings(w.db, {
      vendorId: null,
      invoiceNo: null,
      categoryId: cat!.id,
      totalFils: 100,
      today: '2028-02-29',
    });
    expect(r.duplicateInvoice).toBeNull();
  });
});

describe('recurring drafts', () => {
  it('cover the same period as the shared coveredPeriod', async () => {
    await createRecurringDrafts(w.db, '2026-10-07');
    const drafts = await w.db
      .select({
        invoiceDate: schema.expenses.invoiceDate,
        coversFrom: schema.expenses.coversFrom,
        coversTo: schema.expenses.coversTo,
        frequency: schema.recurringExpenseRules.frequency,
      })
      .from(schema.expenses)
      .innerJoin(
        schema.recurringExpenseRules,
        eq(schema.recurringExpenseRules.id, schema.expenses.recurringRuleId),
      );
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      const p = coveredPeriod(d.invoiceDate as PlainDate, d.frequency);
      expect([d.coversFrom, d.coversTo]).toEqual([p.from, p.to]);
    }
  });
});

describe('unit holders', () => {
  const rows = [
    { unitId: 'u1', ownerId: 'a', shareBp: 6000, fromDate: '2020-01-01', toDate: '2026-06-01' },
    { unitId: 'u1', ownerId: 'b', shareBp: 4000, fromDate: '2020-01-01', toDate: null },
    { unitId: 'u1', ownerId: 'c', shareBp: 6000, fromDate: '2026-06-01', toDate: null },
    { unitId: 'u2', ownerId: 'd', shareBp: 10000, fromDate: '2027-01-01', toDate: null },
  ];
  it('match ownersOnDate for every unit and date, falling back to the current owners', () => {
    for (const date of ['2019-12-31', '2021-05-05', '2026-06-01', '2027-02-01'] as PlainDate[]) {
      const of = holdersByUnit(rows, date);
      for (const unitId of ['u1', 'u2', 'u3']) {
        const typed = rows.map((r) => ({
          ...r,
          fromDate: r.fromDate as PlainDate,
          toDate: r.toDate as PlainDate | null,
        }));
        let expected = ownersOnDate(typed, unitId, date);
        if (expected.length === 0)
          expected = typed
            .filter((r) => r.unitId === unitId && r.toDate === null)
            .map((r) => ({ ownerId: r.ownerId, shareBp: r.shareBp }));
        expect(of(unitId), `${unitId} ${date}`).toEqual(expected);
      }
    }
  });
});

describe('void route', () => {
  it('refuses a void without a reason', async () => {
    const admin = await w.staffToken('admin@vamar.test');
    const [x] = await w.db
      .select({ id: schema.expenses.id })
      .from(schema.expenses)
      .where(eq(schema.expenses.status, 'posted'))
      .limit(1);
    const r = await w.request(`/api/staff/expenses/${x!.id}/void`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(422);
  });
});

describe('rent totals', () => {
  it('the staff report equals summariseRent and netFils over the raw cheques', async () => {
    const viewer = await w.staffToken('viewer@vamar.test');
    const r = await w.json<{
      period: { from: string; to: string };
      rent: {
        expectedFils: number;
        collectedFils: number;
        outstandingFils: number;
        atRiskFils: number;
        chequeCount: number;
        bouncedCount: number;
      };
      expenses: { fixedFils: number; variableFils: number };
      netFils: number;
    }>('/api/staff/reports/summary?preset=this_year', { token: viewer });
    expect(r.status).toBe(200);
    const { from, to } = r.body.period;
    const rows = await w.db
      .select({ status: schema.cheques.status, amountFils: schema.cheques.amountFils })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(
        sql`${schema.contracts.status} <> 'draft' and ${schema.cheques.amountFils} is not null and ${schema.cheques.dueDate} between ${from} and ${to}`,
      );
    const expected = summariseRent(
      rows.map((x) => ({ status: x.status, amountFils: x.amountFils ?? 0 })),
    );
    expect(r.body.rent).toMatchObject(expected);
    expect(expected.chequeCount).toBeGreaterThan(0);
    expect(r.body.netFils).toBe(netFils(r.body.rent.collectedFils, r.body.expenses));
  });
});
