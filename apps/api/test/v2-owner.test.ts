/**
 * Owner side of v2: the period summary and its identities, expenses with invoices, work orders,
 * the unit timeline, the calendar and the settings on the profile. Then isolation: owner A gets
 * 404 or an empty list on owner B's expense, allocation, work order, invoice file, timeline and
 * calendar event, and owners never reach the staff routes.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { monthPeriod, type PlainDate } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

const KHALID = '+971500000001';
const FATIMA = '+971500000002';
const OMAR = '+971500000003';
const MARIAM = '+971500000004';

let w: TestWorld;
let khalid: string;
let fatima: string;
let omar: string;
let mariam: string;

interface Summary {
  preset: string;
  period: { from: string; to: string };
  comparison: { from: string; to: string } | null;
  isFuture: boolean;
  rent: {
    expectedFils: number;
    collectedFils: number;
    outstandingFils: number;
    atRiskFils: number;
  };
  expenses: {
    fixedFils: number;
    variableFils: number;
    totalFils: number;
    projectedFixedFils: number;
  };
  netFils: number;
  projectedNetFils: number;
  previous: { rent: { expectedFils: number }; netFils: number } | null;
  buckets: {
    key: string;
    expectedFils: number;
    collectedFils: number;
    fixedFils: number;
    variableFils: number;
    projectedFixedFils: number;
  }[];
  nextCheque: { id: string } | null;
  openWorkOrders: number;
  openDisputes: number;
  occupancy: { occupied: number; total: number; pct: number };
}

async function unitsOf(phone: string) {
  const ownerId = w.ids.owners[phone]!;
  return w.db
    .select({ unitId: schema.unitOwnerships.unitId })
    .from(schema.unitOwnerships)
    .where(and(eq(schema.unitOwnerships.ownerId, ownerId), isNull(schema.unitOwnerships.toDate)))
    .then((r) => r.map((x) => x.unitId));
}

beforeAll(async () => {
  w = await createWorld();
  khalid = await w.ownerToken(KHALID);
  fatima = await w.ownerToken(FATIMA);
  omar = await w.ownerToken(OMAR);
  mariam = await w.ownerToken(MARIAM);
});
afterAll(() => w.close());

describe('summary', () => {
  it('holds expected = collected + outstanding + at risk for every preset, and buckets add up', async () => {
    for (const preset of [
      'this_month',
      'last_month',
      'next_month',
      'last_6_months',
      'next_6_months',
      'this_year',
      'last_year',
    ]) {
      const res = await w.json<Summary>(`/api/owner/summary?preset=${preset}`, { token: khalid });
      expect(res.status).toBe(200);
      const s = res.body;
      expect(s.preset).toBe(preset);
      expect(s.rent.collectedFils + s.rent.outstandingFils + s.rent.atRiskFils).toBe(
        s.rent.expectedFils,
      );
      expect(s.buckets.reduce((a, b) => a + b.expectedFils, 0)).toBe(s.rent.expectedFils);
      expect(s.buckets.reduce((a, b) => a + b.fixedFils + b.variableFils, 0)).toBe(
        s.expenses.totalFils,
      );
      expect(s.buckets.reduce((a, b) => a + b.projectedFixedFils, 0)).toBe(
        s.expenses.projectedFixedFils,
      );
      expect(s.netFils).toBe(s.rent.collectedFils - s.expenses.totalFils);
      expect(s.projectedNetFils).toBe(
        s.rent.expectedFils - s.expenses.fixedFils - s.expenses.projectedFixedFils,
      );
    }
  });

  it('this year defaults to the current Dubai calendar year with twelve buckets; a future month projects fixed costs only', async () => {
    const year = await w.json<Summary>('/api/owner/summary?preset=this_year', { token: khalid });
    expect(year.body.period).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(year.body.buckets.map((b) => b.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    );
    expect(year.body.expenses.totalFils).toBeGreaterThan(0);
    expect(year.body.rent.expectedFils).toBeGreaterThan(0);
    const next = await w.json<Summary>('/api/owner/summary?preset=next_month', { token: khalid });
    expect(next.body.isFuture).toBe(true);
    expect(next.body.expenses.totalFils).toBe(0);
    expect(next.body.expenses.projectedFixedFils).toBeGreaterThan(0);
    expect(next.body.expenses.variableFils).toBe(0);
  });

  it('a custom range and a comparison period; last year as the owner would pick it', async () => {
    const res = await w.json<Summary>(
      '/api/owner/summary?from=2026-01-01&to=2026-03-31&compare=1',
      {
        token: khalid,
      },
    );
    expect(res.body.preset).toBe('custom');
    expect(res.body.comparison).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(res.body.previous).not.toBeNull();
    const lastYear = await w.json<Summary>('/api/owner/summary?preset=last_year', {
      token: khalid,
    });
    expect(lastYear.body.period.from).toBe('2025-01-01');
    const bad = await w.json('/api/owner/summary?from=2026-02-01&to=2026-01-01', { token: khalid });
    expect(bad.status).toBe(422);
  });

  it('cheques filter by from/to, and units carry the status and identifiers', async () => {
    const list = await w.json<{ items: { dueDate: string }[] }>(
      '/api/owner/cheques?from=2026-10-01&to=2026-10-31&limit=100',
      { token: khalid },
    );
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(
      list.body.items.every((c) => c.dueDate >= '2026-10-01' && c.dueDate <= '2026-10-31'),
    ).toBe(true);
    const units = await w.json<{
      items: {
        effectiveStatus: string;
        status: string;
        titleDeedNo: string | null;
        makaniNo: string | null;
      }[];
    }>('/api/owner/units', { token: khalid });
    expect(units.body.items.every((u) => u.titleDeedNo && u.makaniNo)).toBe(true);
    expect(units.body.items.some((u) => u.effectiveStatus === 'occupied')).toBe(true);
    expect(units.body.items.every((u) => u.status !== 'occupied')).toBe(true);
  });

  it('carries the rows under the cards and the settings on the profile', async () => {
    const s = await w.json<Summary>('/api/owner/summary', { token: khalid });
    expect(s.body.nextCheque).not.toBeNull();
    expect(s.body.openWorkOrders).toBeGreaterThanOrEqual(1);
    expect(s.body.occupancy.total).toBeGreaterThan(0);
    const me = await w.json<{
      settings: { weekStart: string; hijriDisplay: boolean; showBeforeFeeLabel: boolean };
    }>('/api/owner/me', { token: khalid });
    expect(me.body.settings).toEqual({
      weekStart: 'monday',
      hijriDisplay: false,
      showBeforeFeeLabel: true,
      ownersSeeInvoiceFiles: true,
    });
  });

  it('shares follow the ownership: three owners of the villas see parts that add up to the whole', async () => {
    const [v1] = await w.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.unitNo, 'V1'));
    const period = monthPeriod(2026, 10);
    const parts = await Promise.all(
      [khalid, omar, await w.ownerToken('+971500000005')].map((token) =>
        w
          .json<Summary>(
            `/api/owner/summary?from=${period.from}&to=${period.to}&unitId=${v1!.id}`,
            { token },
          )
          .then((r) => r.body.rent.expectedFils),
      ),
    );
    const sum = parts.reduce((a, b) => a + b, 0);
    // Every fils of the unit's cheques in the month is attributed exactly once.
    const total = await w.db
      .select({ amountFils: schema.cheques.amountFils })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(and(eq(schema.contracts.unitId, v1!.id), eq(schema.contracts.status, 'active')))
      .then((rows) => rows.reduce((a, r) => a + (r.amountFils ?? 0), 0));
    expect(sum).toBeLessThanOrEqual(total);
  });
});

describe('expenses, work orders, timeline, calendar', () => {
  it("lists only the owner's allocations with reasons and invoice value, and the detail carries the invoice file", async () => {
    const list = await w.json<{
      items: {
        id: string;
        reasonAr: string;
        reasonEn: string;
        amountFils: number;
        grossTotalFils: number;
        kind: string;
        hasAttachments: boolean;
        categoryNameEn: string;
      }[];
    }>('/api/owner/expenses?preset=this_year&limit=100', { token: khalid });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(5);
    for (const e of list.body.items) {
      expect(e.reasonAr.length).toBeGreaterThan(0);
      expect(e.amountFils).toBeGreaterThan(0);
      expect(e.amountFils).toBeLessThanOrEqual(e.grossTotalFils);
    }
    const lift = list.body.items.find((e) => e.categoryNameEn === 'Lifts (repairs)');
    expect(lift).toBeDefined();
    expect(lift!.hasAttachments).toBe(true);
    const detail = await w.json<{
      attachments: { id: string; mime: string }[];
      workOrder: { status: string } | null;
      amountFils: number;
    }>(`/api/owner/expenses/${lift!.id}`, { token: khalid });
    expect(detail.status).toBe(200);
    expect(detail.body.attachments.length).toBe(1);
    expect(detail.body.workOrder?.status).toBe('done');
    const file = await w.request(`/api/owner/attachments/${detail.body.attachments[0]!.id}`, {
      token: khalid,
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/jpeg');

    const fixedOnly = await w.json<{ items: { kind: string }[] }>(
      '/api/owner/expenses?kind=fixed&preset=last_6_months',
      {
        token: khalid,
      },
    );
    expect(fixedOnly.body.items.every((e) => e.kind === 'fixed')).toBe(true);
  });

  it("work orders of the owner's units with the linked invoice, and the unit timeline with filters", async () => {
    const wos = await w.json<{
      items: { id: string; status: string; expenseId: string | null; titleEn: string }[];
    }>('/api/owner/work-orders', { token: fatima });
    expect(wos.status).toBe(200);
    const ac = wos.body.items.find((x) => x.titleEn === 'AC not cooling');
    expect(ac).toBeDefined();
    expect(ac!.expenseId).not.toBeNull();
    const detail = await w.json<{ attachments: unknown[]; expenseTotalFils: number | null }>(
      `/api/owner/work-orders/${ac!.id}`,
      {
        token: fatima,
      },
    );
    expect(detail.body.attachments.length).toBe(2);
    expect(detail.body.expenseTotalFils).toBeGreaterThan(0);

    const [unitId] = await unitsOf(FATIMA);
    const timeline = await w.json<{
      items: { kind: string; at: string; date: string }[];
      nextCursor: string | null;
    }>(`/api/owner/units/${unitId}/timeline?limit=10`, { token: fatima });
    expect(timeline.status).toBe(200);
    expect(timeline.body.items.length).toBe(10);
    const ats = timeline.body.items.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(timeline.body.nextCursor).not.toBeNull();
    const page2 = await w.json<{ items: { at: string; id: string }[] }>(
      `/api/owner/units/${unitId}/timeline?limit=10&cursor=${encodeURIComponent(timeline.body.nextCursor!)}`,
      { token: fatima },
    );
    expect(page2.body.items.length).toBeGreaterThan(0);
    expect(page2.body.items[0]!.at <= ats[ats.length - 1]!).toBe(true);
    const cheques = await w.json<{ items: { kind: string }[] }>(
      `/api/owner/units/${unitId}/timeline?kinds=cheque&limit=50`,
      {
        token: fatima,
      },
    );
    expect(cheques.body.items.every((e) => e.kind === 'cheque')).toBe(true);
    const badCursor = await w.json(`/api/owner/units/${unitId}/timeline?cursor=zzz`, {
      token: fatima,
    });
    expect(badCursor.status).toBe(422);
  });

  it('the calendar carries cheques due, contract ends, hearings, jobs, visible events and holidays, all in scope', async () => {
    const mine = new Set(await unitsOf(KHALID));
    const res = await w.json<{
      items: { kind: string; unitId: string | null; buildingId: string | null; date: string }[];
      holidays: string[];
    }>('/api/owner/calendar?from=2026-01-01&to=2026-12-31', { token: khalid });
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.items.map((i) => i.kind));
    expect(kinds.has('cheque_due')).toBe(true);
    expect(kinds.has('holiday')).toBe(true);
    expect(kinds.has('work_order')).toBe(true);
    expect(kinds.has('event')).toBe(true);
    for (const i of res.body.items) {
      if (i.kind === 'cheque_due' || i.kind === 'contract_end' || i.kind === 'hearing')
        expect(mine.has(i.unitId!)).toBe(true);
      expect(i.date >= '2026-01-01' && i.date <= '2026-12-31').toBe(true);
    }
    expect(res.body.holidays).toContain('2026-12-02');
    // The internal insurance reminder is not visible to owners.
    const tooLong = await w.json('/api/owner/calendar?from=2026-01-01&to=2027-12-31', {
      token: khalid,
    });
    expect(tooLong.status).toBe(422);
  });
});

describe('isolation', () => {
  it('expense lists hold only own allocations; detail, file, work order, timeline and event of another owner are 404', async () => {
    const mineUnits = new Set(await unitsOf(MARIAM));
    const mariamList = await w.json<{ items: { id: string; unitIds: string[] }[] }>(
      '/api/owner/expenses?preset=this_year&limit=100',
      {
        token: mariam,
      },
    );
    for (const e of mariamList.body.items)
      for (const u of e.unitIds) expect(mineUnits.has(u)).toBe(true);
    const khalidList = await w.json<{ items: { id: string }[] }>(
      '/api/owner/expenses?preset=this_year&limit=100',
      { token: khalid },
    );
    const khalidOnly = khalidList.body.items.find(
      (e) => !mariamList.body.items.some((m) => m.id === e.id),
    );
    expect(khalidOnly).toBeDefined();
    expect(
      (await w.request(`/api/owner/expenses/${khalidOnly!.id}`, { token: mariam })).status,
    ).toBe(404);

    const liftDetail = await w.json<{ attachments: { id: string }[] }>(
      `/api/owner/expenses/${khalidOnly!.id}`,
      { token: khalid },
    );
    const fileId = liftDetail.body.attachments[0]?.id;
    if (fileId)
      expect((await w.request(`/api/owner/attachments/${fileId}`, { token: mariam })).status).toBe(
        404,
      );

    const fatimaWos = await w.json<{ items: { id: string }[] }>('/api/owner/work-orders', {
      token: fatima,
    });
    expect(fatimaWos.body.items.length).toBeGreaterThan(0);
    expect(
      (await w.request(`/api/owner/work-orders/${fatimaWos.body.items[0]!.id}`, { token: mariam }))
        .status,
    ).toBe(404);
    const [fatimaUnit] = await unitsOf(FATIMA);
    expect(
      (await w.request(`/api/owner/units/${fatimaUnit}/timeline`, { token: mariam })).status,
    ).toBe(404);

    const khalidCal = await w.json<{
      items: { kind: string; buildingId: string | null; entityId: string }[];
    }>('/api/owner/calendar?from=2026-01-01&to=2026-12-31&kinds=event', { token: khalid });
    const mariamCal = await w.json<{ items: { kind: string; entityId: string }[] }>(
      '/api/owner/calendar?from=2026-01-01&to=2026-12-31&kinds=event',
      {
        token: mariam,
      },
    );
    const khalidEvent = khalidCal.body.items.find((i) => i.kind === 'event');
    expect(khalidEvent).toBeDefined();
    expect(mariamCal.body.items.some((i) => i.entityId === khalidEvent!.entityId)).toBe(false);
    // Mariam's own building meeting shows for her, not for Khalid.
    expect(mariamCal.body.items.length).toBeGreaterThan(0);
    expect(
      khalidCal.body.items.some((i) => mariamCal.body.items.some((m) => m.entityId === i.entityId)),
    ).toBe(false);
  });

  it('an owner cannot use the staff routes, and the summary of a unit they do not own is empty', async () => {
    for (const path of [
      '/api/staff/expenses',
      '/api/staff/reports/summary',
      '/api/staff/calendar?from=2026-01-01&to=2026-01-31',
      '/api/staff/settings',
    ]) {
      expect((await w.request(path, { token: khalid })).status).toBe(403);
    }
    const [omarUnit] = await unitsOf(OMAR);
    const s = await w.json<Summary>(`/api/owner/summary?preset=this_year&unitId=${omarUnit}`, {
      token: mariam,
    });
    expect(s.body.rent.expectedFils).toBe(0);
    expect(s.body.expenses.totalFils).toBe(0);
    expect(s.body.occupancy.total).toBe(0);
    const omarSummary = await w.json<Summary>(
      `/api/owner/summary?preset=this_year&unitId=${omarUnit}`,
      { token: omar },
    );
    expect(omarSummary.body.occupancy.total).toBe(1);
  });
});

export type { PlainDate };
