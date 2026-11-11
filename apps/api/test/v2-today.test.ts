/**
 * The staff Today panel (GET /api/staff/today) against the seed, with today pinned by the
 * harness (TEST_TODAY = 2026-10-07): every count is checked against a fixed number and against
 * a second, plainly written query, so a seed change shows up as a clear diff here.
 */
import { and, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StaffToday } from '../src/services/today.js';
import { rowsOf as rows } from '../src/db.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

const { cheques, contracts, disputes, disputeCheques, workOrders, expenses } = schema;

let w: TestWorld;
let viewer: string;

beforeAll(async () => {
  w = await createWorld();
  viewer = await w.staffToken('viewer@vamar.test');
});
afterAll(() => w.close());

async function load() {
  const res = await w.json<StaffToday>('/api/staff/today', { token: viewer });
  expect(res.status).toBe(200);
  return res.body;
}

/** The same figures, written one query each with the query builder. */
async function expected() {
  const pending = (from: string, to: string) =>
    w.db
      .select({
        n: sql<number>`count(*)::int`,
        // bigint: a string or a number depending on the driver.
        fils: sql<string | number>`coalesce(sum(${cheques.amountFils}), 0)::bigint`,
      })
      .from(cheques)
      .innerJoin(contracts, eq(contracts.id, cheques.contractId))
      .where(
        and(
          inArray(cheques.status, ['upcoming', 'deposited']),
          ne(contracts.status, 'draft'),
          gte(cheques.dueDate, from),
          lte(cheques.dueDate, to),
        ),
      );
  const [dueToday] = await pending(TODAY, TODAY);
  const [dueSoon] = await pending(addDays(TODAY, 1), addDays(TODAY, 3));
  const bounced = await w.db
    .select({ amount: cheques.amountFils, due: cheques.dueDate, case: disputeCheques.disputeId })
    .from(cheques)
    .leftJoin(disputeCheques, eq(disputeCheques.chequeId, cheques.id))
    .where(eq(cheques.status, 'bounced'));
  const noCase = bounced.filter((b) => b.case === null);
  const hearings = await w.db
    .select({ d: disputes.nextHearingDate })
    .from(disputes)
    .where(
      and(
        ne(disputes.status, 'closed'),
        gte(disputes.nextHearingDate, TODAY),
        lte(disputes.nextHearingDate, addDays(TODAY, 7)),
      ),
    );
  const overdue = await w.db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(
      and(
        inArray(workOrders.status, ['open', 'scheduled', 'in_progress']),
        lt(workOrders.scheduledFor, TODAY),
      ),
    );
  const drafts = await w.db
    .select({ total: expenses.totalFils })
    .from(expenses)
    .where(eq(expenses.status, 'draft'));
  const renewal = schema.contracts;
  const ending = await w.db
    .select({ id: contracts.id, next: sql<string | null>`r.id` })
    .from(contracts)
    .leftJoin(sql`${renewal} r`, sql`r.previous_contract_id = ${contracts.id}`)
    .where(
      and(
        eq(contracts.status, 'active'),
        gte(contracts.endDate, TODAY),
        lte(contracts.endDate, addDays(TODAY, 30)),
      ),
    );
  return {
    dueToday: { count: dueToday!.n, amountFils: Number(dueToday!.fils) },
    dueSoon: { count: dueSoon!.n, amountFils: Number(dueSoon!.fils) },
    bouncedNoCase: {
      count: noCase.length,
      amountFils: noCase.reduce((s, b) => s + (b.amount ?? 0), 0),
    },
    hearings: hearings.length,
    overdueWorkOrders: overdue.length,
    expenseDrafts: { count: drafts.length, totalFils: drafts.reduce((s, d) => s + d.total, 0) },
    contractsEnding: new Set(ending.filter((e) => e.next === null).map((e) => e.id)).size,
  };
}

describe('GET /api/staff/today', () => {
  it('returns every figure of the panel for the pinned day, as the seed has them', async () => {
    const t = await load();
    expect(t).toEqual({
      today: '2026-10-07',
      dueToday: { count: 9, amountFils: 15_524_800 },
      dueSoon: { count: 0, amountFils: 0, from: '2026-10-08', to: '2026-10-10' },
      bouncedNoCase: {
        count: 2,
        amountFils: 23_700_000,
        oldestDueDate: '2026-07-07',
        newestDueDate: '2026-09-07',
      },
      hearings: { count: 1, next: '2026-10-14', from: '2026-10-07', to: '2026-10-14' },
      overdueWorkOrders: { count: 1, oldestScheduledFor: '2026-10-02' },
      expenseDrafts: { count: 0, totalFils: 0, oldestInvoiceDate: null, newestInvoiceDate: null },
      contractsEnding: { count: 1, from: '2026-10-07', to: '2026-11-06' },
      // The seeded fire inspection waits for the Al Noor owner.
      ownerApprovals: { workOrders: 1, expenses: 0, rejected: 0, silentLast7Days: 0 },
      // The seeded Al Noor lift repairs line is past 80 % of its budget.
      budgets: { year: 2026, near: 1, over: 0 },
    });
    const e = await expected();
    expect(t).toMatchObject({
      dueToday: e.dueToday,
      dueSoon: e.dueSoon,
      bouncedNoCase: e.bouncedNoCase,
      hearings: { count: e.hearings },
      overdueWorkOrders: { count: e.overdueWorkOrders },
      expenseDrafts: e.expenseDrafts,
      contractsEnding: { count: e.contractsEnding },
    });
  });

  it('each line links to a list filter that returns the same rows', async () => {
    const t = await load();
    const list = async (path: string) => {
      const res = await w.json<{ items: { id: string; status?: string }[] }>(path, {
        token: viewer,
      });
      expect(res.status, path).toBe(200);
      return res.body.items;
    };
    const pending = 'status=upcoming,deposited&limit=100';
    expect(await list(`/api/staff/cheques?from=${TODAY}&to=${TODAY}&${pending}`)).toHaveLength(
      t.dueToday.count,
    );
    expect(
      await list(`/api/staff/cheques?from=${t.dueSoon.from}&to=${t.dueSoon.to}&${pending}`),
    ).toHaveLength(t.dueSoon.count);
    // The cheque list has no "without a case" filter: the link shows every bounced cheque of
    // those dates, the ones already in a case included.
    const bounced = await list(
      `/api/staff/cheques?status=bounced&from=${t.bouncedNoCase.oldestDueDate}&to=${t.bouncedNoCase.newestDueDate}`,
    );
    expect(bounced.length).toBeGreaterThanOrEqual(t.bouncedNoCase.count);
    expect(
      await list(`/api/staff/disputes?hearingFrom=${t.hearings.from}&hearingTo=${t.hearings.to}`),
    ).toHaveLength(t.hearings.count);
    expect(await list('/api/staff/work-orders?overdue=1')).toHaveLength(t.overdueWorkOrders.count);
    const ending = await list('/api/staff/contracts?endingWithinDays=30&withoutRenewal=1');
    expect(ending).toHaveLength(t.contractsEnding.count);
    // Without the renewal filter the list is at least as long (a drafted renewal is not hidden).
    expect((await list('/api/staff/contracts?endingWithinDays=30')).length).toBeGreaterThanOrEqual(
      ending.length,
    );
    expect((await w.request('/api/staff/work-orders?overdue=yes', { token: viewer })).status).toBe(
      422,
    );
  });

  it('follows the data: each change moves its own line and nothing else', async () => {
    const before = await load();
    // A cheque of today moves to tomorrow: out of "today", into "next 3 days".
    const [moved] = rows<{ id: string; amount_fils: number | string }>(
      await w.db.execute(sql`
        update cheques set due_date = ${addDays(TODAY, 1)}
        where id = (select q.id from cheques q join contracts c on c.id = q.contract_id
                    where q.due_date = ${TODAY} and q.status in ('upcoming', 'deposited')
                      and c.status <> 'draft'
                    order by q.id limit 1)
        returning id, amount_fils`),
    );
    // One bounced cheque is put in an existing case.
    await w.db.execute(sql`
      insert into dispute_cheques (dispute_id, cheque_id)
      select (select id from disputes order by case_no limit 1),
             (select id from cheques q where q.status = 'bounced'
                and not exists (select 1 from dispute_cheques dc where dc.cheque_id = q.id)
              order by q.due_date limit 1)`);
    // The overdue job is done; an expense goes back to draft; the ending contract gets a renewal.
    await w.db.execute(sql`
      update work_orders set status = 'done', completed_at = now()
      where status in ('open', 'scheduled', 'in_progress') and scheduled_for < ${TODAY}`);
    const [draft] = rows<{ invoice_date: string; total_fils: number | string }>(
      await w.db.execute(sql`
        update expenses set status = 'draft'
        where id = (select id from expenses where status = 'posted' order by invoice_date desc, id limit 1)
        returning invoice_date, total_fils`),
    );
    await w.db.execute(sql`
      with ending as (
        select c.id from contracts c where c.status = 'active'
          and c.end_date between ${TODAY} and ${addDays(TODAY, 30)}
          and not exists (select 1 from contracts r where r.previous_contract_id = c.id)
        limit 1)
      update contracts set previous_contract_id = (select id from ending)
      where id = (select id from contracts where previous_contract_id is null
                    and id not in (select id from ending) order by id limit 1)`);

    const after = await load();
    expect(after.dueToday).toEqual({
      count: before.dueToday.count - 1,
      amountFils: before.dueToday.amountFils - Number(moved!.amount_fils),
    });
    expect(after.dueSoon).toMatchObject({ count: 1, amountFils: Number(moved!.amount_fils) });
    expect(after.bouncedNoCase.count).toBe(before.bouncedNoCase.count - 1);
    expect(after.overdueWorkOrders).toEqual({ count: 0, oldestScheduledFor: null });
    expect(after.expenseDrafts).toEqual({
      count: 1,
      totalFils: Number(draft!.total_fils),
      oldestInvoiceDate: draft!.invoice_date,
      newestInvoiceDate: draft!.invoice_date,
    });
    expect(after.contractsEnding.count).toBe(0);
    const drafts = await w.json<{ items: unknown[] }>(
      `/api/staff/expenses?status=draft&from=${after.expenseDrafts.oldestInvoiceDate}&to=${after.expenseDrafts.newestInvoiceDate}`,
      { token: viewer },
    );
    expect(drafts.body.items).toHaveLength(1);
    const ending = (filter: string) =>
      w.json<{ items: unknown[] }>(`/api/staff/contracts?endingWithinDays=30${filter}`, {
        token: viewer,
      });
    // The renewed contract leaves the filtered list but stays in the plain "ending" list.
    expect((await ending('&withoutRenewal=1')).body.items).toHaveLength(0);
    expect((await ending('')).body.items.length).toBeGreaterThan(0);
    expect(after.hearings).toEqual(before.hearings);
    expect(await expected()).toMatchObject({
      dueToday: after.dueToday,
      bouncedNoCase: { count: after.bouncedNoCase.count },
      overdueWorkOrders: 0,
      expenseDrafts: { count: 1 },
      contractsEnding: 0,
    });
  });

  it('is for staff only: an owner token gets 403, no token 401', async () => {
    const owner = await w.ownerToken('+971500000001');
    expect((await w.request('/api/staff/today', { token: owner })).status).toBe(403);
    expect((await w.request('/api/staff/today')).status).toBe(401);
  });
});
