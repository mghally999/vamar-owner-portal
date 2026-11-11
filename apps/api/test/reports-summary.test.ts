/**
 * Staff report summary: the figures of every filter path add up across each other. The report
 * picks a different query shape per filter (expense rows or allocation shares, a join or a lookup
 * per allocation, contracts joined or only drafts left out), so each split is checked against the
 * unsplit report: the buildings add up to the whole portfolio, the categories to the whole, and
 * the same for one owner's share.
 */
import { eq, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

interface Totals {
  rent: { expectedFils: number; collectedFils: number; chequeCount: number };
  expenses: { totalFils: number; vatFils: number; fixedFils: number };
}
interface Summary extends Totals {
  previous: Totals | null;
  buckets: { key: string; expectedFils: number; totalFils: number; vatFils: number }[];
  byCategory: { categoryId: string; totalFils: number; count: number }[];
}

let w: TestWorld;
let viewer: string;
let buildingIds: string[];
let categoryIds: string[];
let ownerId: string;

beforeAll(async () => {
  w = await createWorld();
  viewer = await w.staffToken('viewer@vamar.test');
  buildingIds = (await w.db.select({ id: schema.buildings.id }).from(schema.buildings)).map(
    (b) => b.id,
  );
  categoryIds = (
    await w.db.select({ id: schema.expenseCategories.id }).from(schema.expenseCategories)
  ).map((c) => c.id);
  // The owner with units in the most buildings, so the per-building split is a real split.
  const [top] = await w.db
    .select({ ownerId: schema.unitOwnerships.ownerId })
    .from(schema.unitOwnerships)
    .innerJoin(schema.units, eq(schema.units.id, schema.unitOwnerships.unitId))
    .groupBy(schema.unitOwnerships.ownerId)
    .orderBy(sql`count(distinct ${schema.units.buildingId}) desc`, schema.unitOwnerships.ownerId)
    .limit(1);
  ownerId = top!.ownerId;
});
afterAll(() => w.close());

async function report(query: string): Promise<Summary> {
  const r = await w.json<Summary>(`/api/staff/reports/summary?${query}`, { token: viewer });
  expect(r.status).toBe(200);
  return r.body;
}

function sumOf(parts: Totals[]): Totals {
  const out: Totals = {
    rent: { expectedFils: 0, collectedFils: 0, chequeCount: 0 },
    expenses: { totalFils: 0, vatFils: 0, fixedFils: 0 },
  };
  for (const p of parts) {
    out.rent.expectedFils += p.rent.expectedFils;
    out.rent.collectedFils += p.rent.collectedFils;
    out.rent.chequeCount += p.rent.chequeCount;
    out.expenses.totalFils += p.expenses.totalFils;
    out.expenses.vatFils += p.expenses.vatFils;
    out.expenses.fixedFils += p.expenses.fixedFils;
  }
  return out;
}
const pick = (t: Totals): Totals => ({
  rent: {
    expectedFils: t.rent.expectedFils,
    collectedFils: t.rent.collectedFils,
    chequeCount: t.rent.chequeCount,
  },
  expenses: {
    totalFils: t.expenses.totalFils,
    vatFils: t.expenses.vatFils,
    fixedFils: t.expenses.fixedFils,
  },
});

describe('staff report summary', () => {
  it('the buildings add up to the whole portfolio, this period and the previous one', async () => {
    const base = 'preset=this_year&compare=1';
    const whole = await report(base);
    expect(whole.expenses.totalFils).toBeGreaterThan(0);
    expect(whole.rent.expectedFils).toBeGreaterThan(0);
    const parts = await Promise.all(buildingIds.map((b) => report(`${base}&buildingId=${b}`)));
    expect(sumOf(parts)).toEqual(pick(whole));
    expect(sumOf(parts.map((p) => p.previous!))).toEqual(pick(whole.previous!));
    // Month by month as well.
    for (const [i, bucket] of whole.buckets.entries()) {
      expect(parts.reduce((a, p) => a + p.buckets[i]!.totalFils, 0)).toBe(bucket.totalFils);
      expect(parts.reduce((a, p) => a + p.buckets[i]!.expectedFils, 0)).toBe(bucket.expectedFils);
    }
  });

  it('a category filter gives exactly that category of the unfiltered report', async () => {
    const base = 'preset=this_year&compare=1';
    const whole = await report(base);
    expect(whole.byCategory.reduce((a, c) => a + c.totalFils, 0)).toBe(whole.expenses.totalFils);
    for (const id of categoryIds) {
      const one = await report(`${base}&categoryId=${id}`);
      const row = whole.byCategory.find((c) => c.categoryId === id);
      expect(one.expenses.totalFils).toBe(row?.totalFils ?? 0);
      expect(one.byCategory.map((c) => c.categoryId)).toEqual(row ? [id] : []);
    }
    // Largest first.
    const totals = whole.byCategory.map((c) => c.totalFils);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it("an owner's share splits by building and by category the same way", async () => {
    const base = `preset=this_year&compare=1&ownerId=${ownerId}`;
    const whole = await report(base);
    expect(whole.expenses.totalFils).toBeGreaterThan(0);
    expect(whole.rent.expectedFils).toBeGreaterThan(0);
    const byBuilding = await Promise.all(buildingIds.map((b) => report(`${base}&buildingId=${b}`)));
    expect(byBuilding.filter((p) => p.expenses.totalFils > 0).length).toBeGreaterThan(1);
    expect(sumOf(byBuilding)).toEqual(pick(whole));
    expect(sumOf(byBuilding.map((p) => p.previous!))).toEqual(pick(whole.previous!));
    for (const id of categoryIds) {
      const one = await report(`${base}&categoryId=${id}`);
      const row = whole.byCategory.find((c) => c.categoryId === id);
      expect(one.expenses.totalFils).toBe(row?.totalFils ?? 0);
    }
  });

  it("a unit's report is the same with or without its building", async () => {
    const [u] = await w.db
      .select({ id: schema.expenseAllocations.unitId, buildingId: schema.units.buildingId })
      .from(schema.expenseAllocations)
      .innerJoin(schema.units, eq(schema.units.id, schema.expenseAllocations.unitId))
      .groupBy(schema.expenseAllocations.unitId, schema.units.buildingId)
      .orderBy(sql`count(*) desc`, schema.expenseAllocations.unitId)
      .limit(1);
    const base = `preset=this_year&compare=1&unitId=${u!.id}`;
    const alone = await report(base);
    expect(alone.expenses.totalFils).toBeGreaterThan(0);
    const withBuilding = await report(`${base}&buildingId=${u!.buildingId}`);
    expect(withBuilding).toEqual(alone);
  });
});
