/**
 * Regressions found by the v2 code review: alerts reach every co-owner, hidden costs stay hidden,
 * events addressed to one owner stay with that owner, report months, discarded recurring drafts,
 * timeline paging, allocation method on a scope change, voiding drafts, work-order link audits,
 * duplicate cheque ids, the owner's view of a co-owned unit's history, the monthly summary retry,
 * and cheques matched to the ownership valid on their due date.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { ownerVisibleCost } from '../src/services/work-orders.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

const KHALID = '+971500000001';
const FATIMA = '+971500000002';
const OMAR = '+971500000003';
const MARIAM = '+971500000004';
const RASHID = '+971500000005';

let w: TestWorld;
let admin: string;
let editor: string;
let viewer: string;
const b: Record<string, string> = {};
let cats: { id: string; nameEn: string }[];

const cat = (nameEn: string) => cats.find((c) => c.nameEn === nameEn)!.id;

async function unitOf(building: string, unitNo: string): Promise<string> {
  const [u] = await w.db
    .select({ id: schema.units.id })
    .from(schema.units)
    .where(and(eq(schema.units.buildingId, b[building]!), eq(schema.units.unitNo, unitNo)));
  return u!.id;
}

async function giveEveryOwnerADevice(prefix: string) {
  const owners = await w.db.select({ id: schema.owners.id }).from(schema.owners);
  for (const o of owners)
    await w.db
      .insert(schema.devices)
      .values({
        ownerId: o.id,
        deviceId: `${prefix}-${o.id.slice(0, 8)}`,
        platform: 'android',
        pushToken: 'ExponentPushToken[x]',
      })
      .onConflictDoNothing();
}

beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  for (const r of await w.db
    .select({ id: schema.buildings.id, nameEn: schema.buildings.nameEn })
    .from(schema.buildings))
    b[r.nameEn] = r.id;
  cats = (await w.json<{ items: typeof cats }>('/api/staff/expense-categories', { token: viewer }))
    .body.items;
  await giveEveryOwnerADevice('rf');
});
afterAll(() => w.close());

describe('1. alerts reach every owner of a shared item', () => {
  it('a large expense on the villas goes to all three owners, one log row each', async () => {
    const created = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: b['Mamzar Villas'],
        categoryId: cat('Painting'),
        reasonAr: 'دهان خارجي',
        reasonEn: 'Exterior painting',
        invoiceDate: TODAY,
        amountFils: 900_000,
        vatFils: 0,
      }),
    });
    const posted = await w.json<{ large: boolean }>(`/api/staff/expenses/${created.body.id}/post`, {
      method: 'POST',
      token: editor,
    });
    expect(posted.body.large).toBe(true);
    await w.flush();
    const rows = await w.db
      .select({ ownerId: schema.notificationLog.ownerId, result: schema.notificationLog.result })
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, 'large_expense'),
          eq(schema.notificationLog.entityId, created.body.id),
        ),
      );
    expect(new Set(rows.map((r) => r.ownerId))).toEqual(
      new Set([w.ids.owners[RASHID], w.ids.owners[KHALID], w.ids.owners[OMAR]]),
    );
    expect(rows.every((r) => r.result === 'ok')).toBe(true);
  });

  it("a co-owned unit's cheque reminder reaches every co-owner", async () => {
    // Any villa: all four belong to Rashid, Khalid and Omar.
    const [q] = await w.db
      .select({ id: schema.cheques.id })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .innerJoin(schema.units, eq(schema.units.id, schema.contracts.unitId))
      .where(
        and(
          eq(schema.units.buildingId, b['Mamzar Villas']!),
          eq(schema.contracts.status, 'active'),
          eq(schema.cheques.status, 'upcoming'),
        ),
      )
      .limit(1);
    await w.db
      .update(schema.cheques)
      .set({ dueDate: addDays(TODAY, 3) })
      .where(eq(schema.cheques.id, q!.id));
    await runDailyJobs(w.env);
    const rows = await w.db
      .select({ ownerId: schema.notificationLog.ownerId })
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, 'cheque_due_soon'),
          eq(schema.notificationLog.entityId, q!.id),
        ),
      );
    expect(rows).toHaveLength(3);
  });
});

describe('2. a hidden expense never shows on an owner work order', () => {
  it('the owner sees no cost when the paying expense is not visible to owners', async () => {
    const unit = await unitOf('Al Safa Building', '102');
    const exp = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'unit',
        buildingId: b['Al Safa Building'],
        unitId: unit,
        categoryId: cat('Plumbing'),
        reasonAr: 'داخلي',
        reasonEn: 'Internal',
        invoiceDate: TODAY,
        amountFils: 30_000,
        vatFils: 0,
        visibleToOwner: false,
      }),
    });
    await w.json(`/api/staff/expenses/${exp.body.id}/post`, { method: 'POST', token: editor });
    const wo = await w.json<{ id: string }>('/api/staff/work-orders', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        buildingId: b['Al Safa Building'],
        unitId: unit,
        titleAr: 'تسريب',
        titleEn: 'Hidden-cost leak',
        expenseId: exp.body.id,
      }),
    });
    const fatima = await w.ownerToken(FATIMA);
    const detail = await w.json<{ expenseId: string | null; expenseTotalFils: number | null }>(
      `/api/owner/work-orders/${wo.body.id}`,
      { token: fatima },
    );
    expect(detail.status).toBe(200);
    expect(detail.body.expenseId).toBeNull();
    expect(detail.body.expenseTotalFils).toBeNull();
  });

  it('the push uses the same rule: posted and visible, or no cost at all', () => {
    expect(ownerVisibleCost({ status: 'posted', visibleToOwner: true, totalFils: 100 })).toBe(100);
    expect(
      ownerVisibleCost({ status: 'posted', visibleToOwner: false, totalFils: 100 }),
    ).toBeNull();
    expect(ownerVisibleCost({ status: 'draft', visibleToOwner: true, totalFils: 100 })).toBeNull();
    expect(ownerVisibleCost({ status: null, visibleToOwner: null, totalFils: null })).toBeNull();
  });
});

describe('3. an event addressed to one owner stays with that owner', () => {
  it('Rashid does not see an event for Khalid in the building they both own in', async () => {
    const ev = await w.json<{ id: string }>('/api/staff/calendar-events', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        titleAr: 'زيارة',
        titleEn: 'Visit with Khalid',
        startsAt: `${addDays(TODAY, 2)}T10:00:00+04:00`,
        endsAt: `${addDays(TODAY, 2)}T11:00:00+04:00`,
        buildingId: b['Mamzar Villas'],
        ownerId: w.ids.owners[KHALID],
        visibleToOwner: true,
      }),
    });
    const range = `from=${TODAY}&to=${addDays(TODAY, 10)}&kinds=event`;
    const khalid = await w.json<{ items: { entityId: string }[] }>(`/api/owner/calendar?${range}`, {
      token: await w.ownerToken(KHALID),
    });
    const rashid = await w.json<{ items: { entityId: string }[] }>(`/api/owner/calendar?${range}`, {
      token: await w.ownerToken(RASHID),
    });
    expect(khalid.body.items.some((i) => i.entityId === ev.body.id)).toBe(true);
    expect(rashid.body.items.some((i) => i.entityId === ev.body.id)).toBe(false);
  });
});

describe('4. report months', () => {
  it('a period starting on the 20th still measures every month it touches', async () => {
    const r = await w.json<{
      buckets: { key: string; totalUnits: number }[];
      occupancy: { totalUnits: number; pct: number };
    }>('/api/staff/reports/summary?from=2026-01-20&to=2026-03-10', { token: viewer });
    expect(r.body.buckets.map((x) => x.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.body.buckets.every((x) => x.totalUnits === 32)).toBe(true);
    expect(r.body.occupancy.totalUnits).toBe(32);
    expect(r.body.occupancy.pct).toBeGreaterThan(0);
  });
});

describe('5. a discarded recurring draft stays discarded', () => {
  it('deleting the draft voids it, and the daily job does not make it again', async () => {
    const rule = await w.json<{ id: string }>('/api/staff/recurring-rules', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: b['Al Nahda Commercial Centre'],
        categoryId: cat('Internet and intercom'),
        reasonAr: 'اشتراك',
        reasonEn: 'Discard me',
        amountFils: 10_000,
        frequency: 'monthly',
        dayOfMonth: Number(TODAY.slice(8, 10)),
        startDate: addDays(TODAY, -40),
      }),
    });
    await runDailyJobs(w.env);
    const drafts = () =>
      w.db
        .select({ id: schema.expenses.id, status: schema.expenses.status })
        .from(schema.expenses)
        .where(eq(schema.expenses.recurringRuleId, rule.body.id));
    const [draft] = await drafts();
    expect(draft?.status).toBe('draft');
    expect(
      (await w.json(`/api/staff/expenses/${draft!.id}`, { method: 'DELETE', token: editor }))
        .status,
    ).toBe(200);
    const detail = await w.json<{ status: string }>(`/api/staff/expenses/${draft!.id}`, {
      token: viewer,
    });
    expect(detail.body.status).toBe('void');
    const next = await runDailyJobs({ ...w.env, TEST_TODAY: addDays(TODAY, 1) });
    const after = await drafts();
    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe('void');
    expect(next.errors).toEqual([]);
  });
});

describe('7 and 8. timeline paging', () => {
  it('rows sharing one timestamp to the microsecond all come back once across pages', async () => {
    const unit = await unitOf('Al Noor Tower', '1501');
    for (let i = 0; i < 12; i++)
      await w.db.execute(
        sql`insert into unit_status_events (id, unit_id, from_status, to_status, reason, at)
            values (gen_random_uuid(), ${unit}, 'vacant_ready', 'reserved', ${`same ${String(i)}`}, '2026-10-06 10:00:00.123456+00')`,
      );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pageRes: {
        body: { items: { id: string }[]; nextCursor: string | null };
      } = await w.json(
        `/api/staff/units/${unit}/timeline?kinds=status&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { token: viewer },
      );
      seen.push(...pageRes.body.items.map((x) => x.id));
      cursor = pageRes.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('a building timeline reaches every entry of a busy unit, without duplicates', async () => {
    const unit = await unitOf('Al Noor Tower', '1502');
    for (let i = 0; i < 25; i++)
      await w.db.insert(schema.unitStatusEvents).values({
        unitId: unit,
        fromStatus: 'vacant_ready',
        toStatus: 'not_available',
        reason: `busy ${String(i)}`,
        at: new Date(Date.parse('2026-09-01T08:00:00Z') + i * 60_000),
      });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pageRes: {
        body: { items: { id: string; unitId: string }[]; nextCursor: string | null };
      } = await w.json(
        `/api/staff/buildings/${b['Al Noor Tower']}/timeline?kinds=status&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { token: viewer },
      );
      seen.push(...pageRes.body.items.map((x) => `${x.unitId}|${x.id}`));
      cursor = pageRes.body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((k) => k.startsWith(`${unit}|`))).toHaveLength(25);
  });

  it('a building-wide expense on every unit pages without loss or repeats', async () => {
    const perUnit = await w.db
      .select({
        unitId: schema.expenseAllocations.unitId,
        n: sql<number>`count(distinct ${schema.expenseAllocations.expenseId})::int`,
      })
      .from(schema.expenseAllocations)
      .innerJoin(schema.expenses, eq(schema.expenses.id, schema.expenseAllocations.expenseId))
      .innerJoin(schema.units, eq(schema.units.id, schema.expenseAllocations.unitId))
      .where(eq(schema.units.buildingId, b['Al Safa Building']!))
      .groupBy(schema.expenseAllocations.unitId);
    const unitOnly = await w.db
      .select({ unitId: schema.expenses.unitId, n: sql<number>`count(*)::int` })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.buildingId, b['Al Safa Building']!),
          sql`${schema.expenses.status} <> 'void'`,
          sql`${schema.expenses.unitId} is not null`,
          sql`not exists (select 1 from expense_allocations a where a.expense_id = ${schema.expenses.id})`,
        ),
      )
      .groupBy(schema.expenses.unitId);
    const expected = perUnit.reduce((a, r) => a + r.n, 0) + unitOnly.reduce((a, r) => a + r.n, 0);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pageRes: {
        body: { items: { id: string; unitId: string }[]; nextCursor: string | null };
      } = await w.json(
        `/api/staff/buildings/${b['Al Safa Building']}/timeline?kinds=expense&limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { token: viewer },
      );
      seen.push(...pageRes.body.items.map((x) => `${x.unitId}|${x.id}`));
      cursor = pageRes.body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(expected);
  });
});

describe('9, 10, 11. expense life cycle details', () => {
  it('a unit draft moved to the whole building posts with the building method', async () => {
    const unit = await unitOf('Al Noor Tower', '801');
    const draft = await w.json<{ id: string; allocationMethod: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'unit',
        buildingId: b['Al Noor Tower'],
        unitId: unit,
        categoryId: cat('Deep cleaning'),
        reasonAr: 'تنظيف',
        reasonEn: 'Cleaning',
        invoiceDate: TODAY,
        amountFils: 80_000,
        vatFils: 0,
      }),
    });
    expect(draft.body.allocationMethod).toBe('single_unit');
    const moved = await w.json<{ allocationMethod: string }>(
      `/api/staff/expenses/${draft.body.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ scope: 'building', unitId: null }),
      },
    );
    expect(moved.body.allocationMethod).toBe('by_area');
    const posted = await w.json<{ allocations: unknown[] }>(
      `/api/staff/expenses/${draft.body.id}/post`,
      { method: 'POST', token: editor },
    );
    expect(posted.status).toBe(200);
    expect(posted.body.allocations).toHaveLength(8);
  });

  it('only a posted expense can be voided', async () => {
    const draft = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: b['Al Noor Tower'],
        categoryId: cat('Pest control'),
        reasonAr: 'رش',
        reasonEn: 'Spray',
        invoiceDate: TODAY,
        amountFils: 1_000,
        vatFils: 0,
      }),
    });
    const res = await w.json<{ error: { code: string } }>(
      `/api/staff/expenses/${draft.body.id}/void`,
      { method: 'POST', token: admin, body: JSON.stringify({ reason: 'not posted yet' }) },
    );
    expect(res.status).toBe(409);
  });

  it('linking and unlinking a work order are audited', async () => {
    const wo = await w.json<{ id: string }>('/api/staff/work-orders', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        buildingId: b['Al Noor Tower'],
        titleAr: 'إصلاح',
        titleEn: 'Link me',
      }),
    });
    const draft = await w.json<{ id: string }>('/api/staff/expenses', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        scope: 'building',
        buildingId: b['Al Noor Tower'],
        categoryId: cat('General maintenance'),
        reasonAr: 'إصلاح',
        reasonEn: 'Fix',
        invoiceDate: TODAY,
        amountFils: 5_000,
        vatFils: 0,
        workOrderId: wo.body.id,
      }),
    });
    await w.json(`/api/staff/expenses/${draft.body.id}`, { method: 'DELETE', token: editor });
    const actions = await w.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, wo.body.id))
      .orderBy(asc(schema.auditLog.at));
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['work_order.link_expense', 'work_order.unlink_expense']),
    );
  });
});

describe('12. duplicate cheque ids', () => {
  it('a case naming the same cheque twice links it once', async () => {
    const [bounced] = await w.db
      .select({ id: schema.cheques.id, unitId: schema.contracts.unitId })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(eq(schema.cheques.status, 'bounced'))
      .limit(1);
    const res = await w.json<{ id: string; chequeIds: string[] }>('/api/staff/disputes', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        unitId: bounced!.unitId,
        type: 'bounced_cheque',
        chequeIds: [bounced!.id, bounced!.id],
      }),
    });
    expect(res.status).toBe(201);
    expect(res.body.chequeIds).toEqual([bounced!.id]);
  });
});

describe("13. an owner's view of a co-owned unit", () => {
  it('shows only their own ownership and their share of the rent', async () => {
    const v2 = await unitOf('Mamzar Villas', 'V2');
    const khalid = await w.ownerToken(KHALID);
    const res = await w.json<{
      items: {
        kind: string;
        titleEn: string;
        titleAr: string;
        amountFils: number | null;
        entityId: string;
      }[];
    }>(`/api/owner/units/${v2}/timeline?limit=100`, { token: khalid });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body.items);
    expect(text).not.toContain('Rashid Bin Touq');
    expect(text).not.toContain('Omar Haddad');
    const own = res.body.items.filter((i) => i.kind === 'ownership');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((i) => i.titleEn === 'Khalid Al Mansoori')).toBe(true);
    const start = res.body.items.find(
      (i) => i.kind === 'contract' && i.titleAr === 'contract_start',
    );
    const [contract] = await w.db
      .select({ rent: schema.contracts.annualRentFils })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, start!.entityId));
    expect(start!.amountFils).toBe(Math.floor((contract!.rent * 3_000) / 10_000));
  });
});

describe('15. the monthly summary is retried on the 2nd and 3rd', () => {
  it('a failed send on the 1st is made good on the 2nd, never twice, and nothing after the 3rd', async () => {
    // Every push fails in transport on the 1st.
    await runDailyJobs({ ...w.env, TEST_TODAY: '2026-10-01', TEST_PUSH: 'fail' });
    const rows = () =>
      w.db
        .select({ key: schema.notificationLog.dedupeKey, result: schema.notificationLog.result })
        .from(schema.notificationLog)
        .where(eq(schema.notificationLog.type, 'monthly_summary'));
    const first = await rows();
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((r) => r.result.startsWith('failed:'))).toBe(true);
    expect(first.every((r) => r.key.endsWith(':2026-10-01'))).toBe(true);
    await runDailyJobs({ ...w.env, TEST_TODAY: '2026-10-02' });
    const second = await rows();
    expect(second).toHaveLength(first.length);
    expect(second.every((r) => r.result === 'ok')).toBe(true);
    const third = await runDailyJobs({ ...w.env, TEST_TODAY: '2026-10-03' });
    expect(third.sent).toBeGreaterThanOrEqual(0);
    expect(await rows()).toHaveLength(first.length);
    const fourth = await runDailyJobs({ ...w.env, TEST_TODAY: '2026-10-04' });
    expect(fourth.monthlySummaries).toBe(0);
  });
});

describe('6 and 14. cheques follow the ownership valid on their due date', () => {
  it('after a mid-contract sale the buyer and the seller each see their own cheques', async () => {
    const unit = await unitOf('Al Noor Tower', '2001');
    const [contract] = await w.db
      .select({
        id: schema.contracts.id,
        start: schema.contracts.startDate,
        end: schema.contracts.endDate,
      })
      .from(schema.contracts)
      .where(and(eq(schema.contracts.unitId, unit), eq(schema.contracts.status, 'active')));
    const dues = await w.db
      .select({ id: schema.cheques.id, due: schema.cheques.dueDate })
      .from(schema.cheques)
      .where(eq(schema.cheques.contractId, contract!.id))
      .orderBy(asc(schema.cheques.dueDate));
    expect(dues.length).toBeGreaterThan(4);
    const sale = dues[3]!.due;
    const sold = await w.json(`/api/staff/units/${unit}/owners`, {
      method: 'PUT',
      token: editor,
      body: JSON.stringify({
        fromDate: sale,
        owners: [{ ownerId: w.ids.owners[MARIAM], shareBp: 10_000 }],
      }),
    });
    expect(sold.status).toBe(200);
    const range = `from=${contract!.start}&to=${contract!.end}&unitId=${unit}&limit=100`;
    const buyer = await w.json<{ items: { dueDate: string; amountFils: number }[] }>(
      `/api/owner/cheques?${range}`,
      { token: await w.ownerToken(MARIAM) },
    );
    const sellerToken = await w.ownerToken(KHALID);
    const seller = await w.json<{ items: { dueDate: string }[] }>(`/api/owner/cheques?${range}`, {
      token: sellerToken,
    });
    expect(buyer.body.items.length).toBe(dues.length - 3);
    expect(buyer.body.items.every((c) => c.dueDate >= sale)).toBe(true);
    expect(seller.body.items.length).toBe(3);
    expect(seller.body.items.every((c) => c.dueDate < sale)).toBe(true);

    const cal = await w.json<{ items: { kind: string; date: string; unitId: string | null }[] }>(
      `/api/owner/calendar?from=${contract!.start}&to=${contract!.end}&kinds=cheque_due`,
      { token: await w.ownerToken(MARIAM) },
    );
    const mine = cal.body.items.filter((i) => i.unitId === unit);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.date >= sale)).toBe(true);
  });
});
