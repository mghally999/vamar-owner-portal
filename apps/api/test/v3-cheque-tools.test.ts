/**
 * Cheque tools for staff: the all-or-nothing bulk status endpoint, the cheques a bank statement
 * can settle, and the saved bank CSV column mappings.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
let admin: string;
let viewer: string;
let ownerToken: string;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
  admin = await w.staffToken('admin@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  const [phone] = Object.keys(w.ids.owners);
  ownerToken = await w.ownerToken(phone!);
});
afterAll(() => w.close());

/** Seeded cheques of active contracts in one status, not yet used by an earlier test. */
const used = new Set<string>();
async function take(status: 'upcoming' | 'deposited' | 'cleared', n: number) {
  const rows = await w.db
    .select({ id: schema.cheques.id, chequeNo: schema.cheques.chequeNo })
    .from(schema.cheques)
    .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
    .where(and(eq(schema.cheques.status, status), eq(schema.contracts.status, 'active')))
    .orderBy(asc(schema.cheques.dueDate), asc(schema.cheques.id));
  const free = rows.filter((r) => !used.has(r.id)).slice(0, n);
  if (free.length < n) throw new Error(`only ${String(free.length)} ${status} cheques left`);
  for (const r of free) used.add(r.id);
  return free;
}

interface BulkBody {
  updated?: string[];
  notified?: number;
  error?: {
    code: string;
    message: string;
    details?: { rejected: { id: string; code: string; from: string | null }[] };
  };
}
const bulk = (body: unknown, token = editor) =>
  w.json<BulkBody>('/api/staff/cheques/bulk-status', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

const statusOf = async (ids: string[]) =>
  (
    await w.db
      .select({ id: schema.cheques.id, status: schema.cheques.status })
      .from(schema.cheques)
      .where(inArray(schema.cheques.id, ids))
  ).map((r) => r.status);

const eventsOf = (ids: string[]) =>
  w.db
    .select()
    .from(schema.chequeEvents)
    .where(inArray(schema.chequeEvents.chequeId, ids))
    .orderBy(asc(schema.chequeEvents.at));

const auditsOf = (ids: string[]) =>
  w.db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.action, 'cheque.status_change'),
        inArray(schema.auditLog.entityId, ids),
      ),
    );

describe('POST /api/staff/cheques/bulk-status', () => {
  it('deposits several cheques with the bank date, writing the same event and audit rows as a single change', async () => {
    const rows = await take('upcoming', 3);
    const ids = rows.map((r) => r.id);
    const eventsBefore = (await eventsOf(ids)).length;
    const r = await bulk({ ids, status: 'deposited', date: '2026-10-05' });
    expect(r.status).toBe(200);
    expect(r.body.updated?.sort()).toEqual([...ids].sort());
    expect(r.body.notified).toBe(0);
    expect(await statusOf(ids)).toEqual(['deposited', 'deposited', 'deposited']);

    const events = (await eventsOf(ids)).slice(eventsBefore);
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.fromStatus).toBe('upcoming');
      expect(e.toStatus).toBe('deposited');
      expect(e.note).toContain('Bank date 2026-10-05');
      expect(e.actorStaffId).toBe(w.ids.staff['entry@vamar.test']);
    }
    const audits = await auditsOf(ids);
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => (a.before as { status: string }).status === 'upcoming')).toBe(true);
    expect(audits.every((a) => a.actorId === w.ids.staff['entry@vamar.test'])).toBe(true);

    const cheque = await w.db.query.cheques.findFirst({ where: eq(schema.cheques.id, ids[0]!) });
    // Midday in Dubai on the bank date, so the date never shifts with the viewer's zone.
    expect(cheque?.depositedAt?.toISOString()).toBe('2026-10-05T08:00:00.000Z');

    // A date of today keeps the real time of the change.
    const [todayOne] = await take('upcoming', 1);
    expect((await bulk({ ids: [todayOne!.id], status: 'deposited', date: TODAY })).status).toBe(
      200,
    );
    const t = await w.db.query.cheques.findFirst({ where: eq(schema.cheques.id, todayOne!.id) });
    expect(Math.abs(t!.depositedAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('changes nothing when any cheque cannot make the move, and lists each refused cheque', async () => {
    const ok = await take('upcoming', 2);
    const [cleared] = await take('cleared', 1);
    const missing = '00000000-0000-4000-8000-000000000000';
    const ids = [...ok.map((r) => r.id), cleared!.id, missing];
    const eventsBefore = (await eventsOf(ids)).length;
    const r = await bulk({ ids, status: 'deposited', date: '2026-10-06' });
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe('invalid_transition');
    expect(r.body.error?.message).toContain('nothing was changed');
    expect(r.body.error?.details?.rejected).toEqual([
      expect.objectContaining({ id: cleared!.id, code: 'invalid_transition', from: 'cleared' }),
      expect.objectContaining({ id: missing, code: 'not_found', from: null }),
    ]);
    expect(await statusOf(ok.map((o) => o.id))).toEqual(['upcoming', 'upcoming']);
    expect((await eventsOf(ids)).length).toBe(eventsBefore);
    expect(await auditsOf(ok.map((o) => o.id))).toHaveLength(0);
  });

  it('refuses cheques of a draft contract and cheques without an amount', async () => {
    const drafts = await w.db
      .select({ id: schema.cheques.id, amountFils: schema.cheques.amountFils })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(eq(schema.contracts.status, 'draft'));
    const [draft] = drafts;
    const [noAmount] = await take('upcoming', 1);
    await w.db
      .update(schema.cheques)
      .set({ amountFils: null })
      .where(eq(schema.cheques.id, noAmount!.id));
    const r = await bulk({ ids: [draft!.id, noAmount!.id], status: 'deposited', date: TODAY });
    expect(r.status).toBe(422);
    expect(r.body.error?.details?.rejected.map((x) => x.code)).toEqual([
      'draft_contract',
      'no_amount',
    ]);
  });

  it('validates the body: a date (not in the future) except for cancels, a reason for bounces, at most 200 cheques', async () => {
    const [one] = await take('upcoming', 1);
    const future = await bulk({ ids: [one!.id], status: 'deposited', date: '2026-10-08' });
    expect(future.status).toBe(422);
    expect(future.body.error?.message).toMatch(/future/);
    expect((await bulk({ ids: [one!.id], status: 'bounced', date: TODAY })).status).toBe(422);
    expect((await bulk({ ids: [one!.id], status: 'replaced', date: TODAY })).status).toBe(422);
    expect((await bulk({ ids: [one!.id], status: 'deposited' })).status).toBe(422);
    expect((await bulk({ ids: [one!.id], status: 'deposited', date: '07/10/2026' })).status).toBe(
      422,
    );
    const many = Array.from({ length: 201 }, () => one!.id);
    expect((await bulk({ ids: many, status: 'deposited', date: TODAY })).status).toBe(422);
    expect(await statusOf([one!.id])).toEqual(['upcoming']);
    // The same id twice is one change, not a second (illegal) one.
    const twice = await bulk({ ids: [one!.id, one!.id], status: 'deposited', date: TODAY });
    expect(twice.status).toBe(200);
    expect(twice.body.updated).toEqual([one!.id]);
  });

  it('bounces with a reason, alerts the owners exactly as a single bounce does, then clears others', async () => {
    const rows = await take('upcoming', 4);
    const ids = rows.map((r) => r.id);
    expect((await bulk({ ids, status: 'deposited', date: '2026-10-01' })).status).toBe(200);
    const bounceIds = ids.slice(0, 2);
    const b = await bulk({
      ids: bounceIds,
      status: 'bounced',
      date: '2026-10-04',
      reason: 'Insufficient funds',
    });
    expect(b.status).toBe(200);
    expect(b.body.notified).toBe(2);
    await w.flush();
    for (const id of bounceIds) {
      const c = await w.db.query.cheques.findFirst({ where: eq(schema.cheques.id, id) });
      expect(c?.status).toBe('bounced');
      expect(c?.bounceReason).toBe('Insufficient funds');
      expect(c?.bouncedAt?.toISOString()).toBe('2026-10-04T08:00:00.000Z');
      const alerts = await w.db
        .select()
        .from(schema.notificationLog)
        .where(
          and(
            eq(schema.notificationLog.type, 'cheque_bounced'),
            eq(schema.notificationLog.entityId, id),
          ),
        );
      expect(alerts.length).toBeGreaterThanOrEqual(1);
    }
    const events = await eventsOf(bounceIds);
    const last = events.filter((e) => e.toStatus === 'bounced');
    expect(last).toHaveLength(2);
    expect(last[0]?.note).toContain('Insufficient funds');

    const clearIds = ids.slice(2);
    const c = await bulk({ ids: clearIds, status: 'cleared', date: '2026-10-03' }, admin);
    expect(c.status).toBe(200);
    expect(c.body.notified).toBe(0);
    expect(await statusOf(clearIds)).toEqual(['cleared', 'cleared']);
  });

  it('cancels upcoming cheques like a single cancel: no date needed, same rows, no owner alert', async () => {
    const rows = await take('upcoming', 2);
    const ids = rows.map((r) => r.id);
    const eventsBefore = (await eventsOf(ids)).length;
    const r = await bulk({ ids, status: 'cancelled', note: 'Contract ended early' });
    expect(r.status).toBe(200);
    expect(r.body.updated?.sort()).toEqual([...ids].sort());
    expect(r.body.notified).toBe(0);
    expect(await statusOf(ids)).toEqual(['cancelled', 'cancelled']);
    const events = (await eventsOf(ids)).slice(eventsBefore);
    expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      ['upcoming', 'cancelled'],
      ['upcoming', 'cancelled'],
    ]);
    expect(events.every((e) => e.note === 'Contract ended early')).toBe(true);
    const audits = await auditsOf(ids);
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => (a.after as { status: string }).status === 'cancelled')).toBe(true);
    await w.flush();
    const alerts = await w.db
      .select()
      .from(schema.notificationLog)
      .where(inArray(schema.notificationLog.entityId, ids));
    expect(alerts).toHaveLength(0);

    // A date sent with a cancel is not stamped or noted: a cancel has no bank date.
    const [dated] = await take('upcoming', 1);
    expect((await bulk({ ids: [dated!.id], status: 'cancelled', date: '2026-10-01' })).status).toBe(
      200,
    );
    const [ev] = (await eventsOf([dated!.id])).slice(-1);
    expect(ev?.note).toBe('');
  });

  it('refuses the whole cancel when one cheque cannot be cancelled', async () => {
    const rows = await take('upcoming', 2);
    const [keep, deposit] = rows.map((r) => r.id) as [string, string];
    expect((await bulk({ ids: [deposit], status: 'deposited', date: TODAY })).status).toBe(200);
    const eventsBefore = (await eventsOf([keep, deposit])).length;
    const r = await bulk({ ids: [keep, deposit], status: 'cancelled' });
    expect(r.status).toBe(422);
    expect(r.body.error?.details?.rejected).toEqual([
      expect.objectContaining({ id: deposit, code: 'invalid_transition', from: 'deposited' }),
    ]);
    expect(await statusOf([keep])).toEqual(['upcoming']);
    expect(await statusOf([deposit])).toEqual(['deposited']);
    expect((await eventsOf([keep, deposit])).length).toBe(eventsBefore);
    // Viewers cannot cancel either.
    expect((await bulk({ ids: [keep], status: 'cancelled' }, viewer)).status).toBe(403);
  });

  it('is for editors and admins only', async () => {
    const [one] = await take('upcoming', 1);
    const body = { ids: [one!.id], status: 'deposited', date: TODAY };
    expect((await bulk(body, viewer)).status).toBe(403);
    expect([401, 403]).toContain((await bulk(body, ownerToken)).status);
    expect(
      (
        await w.request('/api/staff/cheques/bulk-status', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(401);
    expect(await statusOf([one!.id])).toEqual(['upcoming']);
  });
});

describe('GET /api/staff/cheques/bank-candidates', () => {
  interface Candidate {
    id: string;
    status: string;
    dueDate: string;
    depositedOn: string | null;
    amountFils: number | null;
  }
  const get = (q: string, token = editor) =>
    w.json<{ items: Candidate[] }>(`/api/staff/cheques/bank-candidates?${q}`, { token });

  it('lists upcoming cheques due in the window and every deposited cheque', async () => {
    const r = await get('from=2026-09-01&to=2026-10-31');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    for (const c of r.body.items) {
      expect(['upcoming', 'deposited']).toContain(c.status);
      if (c.status === 'upcoming') {
        expect(c.dueDate >= '2026-09-01' && c.dueDate <= '2026-10-31').toBe(true);
      } else expect(c.depositedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Deposited on 5 Oct by the first test above, whatever their due date.
    expect(r.body.items.some((c) => c.depositedOn === '2026-10-05')).toBe(true);
  });

  it('checks the window and the role', async () => {
    expect((await get('from=2026-10-31&to=2026-10-01')).status).toBe(422);
    expect((await get('from=2025-01-01&to=2026-10-31')).status).toBe(422);
    expect((await get('from=2026-10-01')).status).toBe(422);
    expect((await get('from=2026-10-01&to=2026-10-31', viewer)).status).toBe(403);
  });
});

describe('bank CSV mappings in app_settings', () => {
  interface Mapping {
    bank: string;
    dateColumn: string;
    amountColumn: string;
    chequeNoColumn: string | null;
  }
  const path = '/api/staff/settings/bank-csv-mappings';
  const put = (body: unknown, token = editor) =>
    w.json<{ items: Mapping[] }>(path, { method: 'PUT', token, body: JSON.stringify(body) });

  it('starts empty, saves one mapping per bank, replaces by name, deletes, and audits each write', async () => {
    const empty = await w.json<{ items: Mapping[] }>(path, { token: editor });
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    const enbd = { bank: 'ENBD', dateColumn: 'Txn Date', amountColumn: 'Amount' };
    expect((await put(enbd)).body.items).toEqual([
      expect.objectContaining({ ...enbd, chequeNoColumn: null }),
    ]);
    await put({ bank: 'ADCB', dateColumn: 'Date', amountColumn: 'Credit', debitColumn: 'Debit' });
    const replaced = await put({ ...enbd, bank: 'enbd', chequeNoColumn: 'Cheque No' }, admin);
    expect(replaced.body.items.map((m) => m.bank)).toEqual(['ADCB', 'enbd']);
    expect(replaced.body.items[1]?.chequeNoColumn).toBe('Cheque No');

    const row = await w.db.query.appSettings.findFirst({
      where: eq(schema.appSettings.key, 'bank_csv_mappings'),
    });
    expect((row?.value as Mapping[]).length).toBe(2);
    expect(row?.updatedBy).toBe(w.ids.staff['admin@vamar.test']);

    const del = await w.json<{ items: Mapping[] }>(`${path}?bank=adcb`, {
      method: 'DELETE',
      token: editor,
    });
    expect(del.body.items.map((m) => m.bank)).toEqual(['enbd']);
    // Deleting a bank that is not there changes nothing and writes no audit row.
    await w.json(`${path}?bank=nope`, { method: 'DELETE', token: editor });

    const audits = await w.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'settings.bank_csv_mappings'));
    expect(audits).toHaveLength(4);

    // The general settings screen ignores the extra key.
    expect((await w.json('/api/staff/settings', { token: viewer })).status).toBe(200);
  });

  it('validates the mapping and keeps viewers out', async () => {
    expect((await put({ bank: '', dateColumn: 'D', amountColumn: 'A' })).status).toBe(422);
    expect((await put({ bank: 'X', dateColumn: 'D' })).status).toBe(422);
    expect((await put({ bank: 'X', dateColumn: 'D', amountColumn: 'A' }, viewer)).status).toBe(403);
    expect((await w.json(path, { token: viewer })).status).toBe(403);
    expect((await w.json(`${path}?bank=enbd`, { method: 'DELETE', token: viewer })).status).toBe(
      403,
    );
  });
});
