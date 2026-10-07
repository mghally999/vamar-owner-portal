/**
 * Owner isolation: owner A must get 404 on owner B's cheque, unit, contract, dispute and file,
 * and every owner list must contain only the caller's own data.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

const KHALID = '+971500000001';
const MARIAM = '+971500000004';

let w: TestWorld;
let khalid: string;
let mariam: string;

beforeAll(async () => {
  w = await createWorld();
  khalid = await w.ownerToken(KHALID);
  mariam = await w.ownerToken(MARIAM);
});
afterAll(() => w.close());

async function unitsOf(ownerPhone: string) {
  const ownerId = w.ids.owners[ownerPhone]!;
  return w.db
    .select({ unitId: schema.unitOwnerships.unitId })
    .from(schema.unitOwnerships)
    .where(and(eq(schema.unitOwnerships.ownerId, ownerId), isNull(schema.unitOwnerships.toDate)))
    .then((r) => r.map((x) => x.unitId));
}

describe('owner isolation', () => {
  it("unit lists never leak another owner's units", async () => {
    const mine = new Set(await unitsOf(KHALID));
    const theirs = new Set(await unitsOf(MARIAM));
    const res = await w.json<{ items: { id: string }[] }>('/api/owner/units', { token: khalid });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(mine.size);
    for (const u of res.body.items) {
      expect(mine.has(u.id)).toBe(true);
      expect(theirs.has(u.id)).toBe(false);
    }
  });

  it('cheque lists are scoped', async () => {
    const mine = new Set(await unitsOf(KHALID));
    const res = await w.json<{ items: { unitId: string }[] }>('/api/owner/cheques?limit=100', {
      token: khalid,
    });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const c of res.body.items) expect(mine.has(c.unitId)).toBe(true);
  });

  it("owner A gets 404 on owner B's unit", async () => {
    const [theirUnit] = await unitsOf(MARIAM);
    const res = await w.request(`/api/owner/units/${theirUnit}`, { token: khalid });
    expect(res.status).toBe(404);
    const ok = await w.request(`/api/owner/units/${theirUnit}`, { token: mariam });
    expect(ok.status).toBe(200);
  });

  it("owner A gets 404 on owner B's cheque and its image", async () => {
    const theirUnits = await unitsOf(MARIAM);
    const [cheque] = await w.db
      .select({ id: schema.cheques.id })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .where(
        and(eq(schema.contracts.unitId, theirUnits[0]!), eq(schema.contracts.status, 'active')),
      )
      .limit(1);
    expect(cheque).toBeDefined();
    expect((await w.request(`/api/owner/cheques/${cheque!.id}`, { token: khalid })).status).toBe(
      404,
    );
    expect(
      (await w.request(`/api/owner/cheques/${cheque!.id}/image`, { token: khalid })).status,
    ).toBe(404);
    expect((await w.request(`/api/owner/cheques/${cheque!.id}`, { token: mariam })).status).toBe(
      200,
    );
  });

  it("owner A gets 404 on owner B's dispute, its updates and attachments", async () => {
    const disputes = await w.db
      .select({ id: schema.disputes.id, unitId: schema.disputes.unitId })
      .from(schema.disputes);
    expect(disputes.length).toBeGreaterThan(0);
    for (const d of disputes) {
      const [ownerRow] = await w.db
        .select({ ownerId: schema.unitOwnerships.ownerId })
        .from(schema.unitOwnerships)
        .where(
          and(eq(schema.unitOwnerships.unitId, d.unitId), isNull(schema.unitOwnerships.toDate)),
        )
        .limit(1);
      const ownerPhone = Object.entries(w.ids.owners).find(
        ([, id]) => id === ownerRow!.ownerId,
      )![0];
      const stranger = ownerPhone === KHALID ? mariam : khalid;
      const self =
        ownerPhone === KHALID
          ? khalid
          : ownerPhone === MARIAM
            ? mariam
            : await w.ownerToken(ownerPhone);
      expect((await w.request(`/api/owner/disputes/${d.id}`, { token: stranger })).status).toBe(
        404,
      );
      expect(
        (await w.request(`/api/owner/disputes/${d.id}/attachments`, { token: stranger })).status,
      ).toBe(404);
      const own = await w.json<{ updates: { note: string }[] }>(`/api/owner/disputes/${d.id}`, {
        token: self,
      });
      expect(own.status).toBe(200);
      // Only owner-visible updates come back
      expect(own.body.updates.every((u) => !u.note.startsWith('Internal'))).toBe(true);
    }
  });

  it("owner A gets 404 on a file attached to owner B's dispute", async () => {
    const admin = await w.staffToken('admin@vamar.test');
    const [d] = await w.db
      .select({ id: schema.disputes.id, unitId: schema.disputes.unitId })
      .from(schema.disputes)
      .limit(1);
    const form = new FormData();
    form.set('entityType', 'dispute');
    form.set('entityId', d!.id);
    form.set(
      'file',
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'notice.pdf', {
        type: 'application/pdf',
      }),
    );
    const up = await w.json<{ id: string }>('/api/staff/attachments', {
      method: 'POST',
      body: form,
      token: admin,
    });
    expect(up.status).toBe(201);
    const [ownerRow] = await w.db
      .select({ ownerId: schema.unitOwnerships.ownerId })
      .from(schema.unitOwnerships)
      .where(and(eq(schema.unitOwnerships.unitId, d!.unitId), isNull(schema.unitOwnerships.toDate)))
      .limit(1);
    const ownerPhone = Object.entries(w.ids.owners).find(([, id]) => id === ownerRow!.ownerId)![0];
    const stranger = ownerPhone === KHALID ? mariam : khalid;
    expect(
      (await w.request(`/api/owner/attachments/${up.body.id}`, { token: stranger })).status,
    ).toBe(404);
    const self = await w.ownerToken(ownerPhone);
    const ok = await w.request(`/api/owner/attachments/${up.body.id}`, { token: self });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
  });

  it('owner tokens cannot call staff routes and staff tokens cannot call owner routes', async () => {
    expect((await w.request('/api/staff/owners', { token: khalid })).status).toBe(403);
    const admin = await w.staffToken('admin@vamar.test');
    expect((await w.request('/api/owner/home', { token: admin })).status).toBe(403);
    expect((await w.request('/api/owner/home')).status).toBe(401);
  });

  it('owner id is never taken from the request', async () => {
    const mariamId = w.ids.owners[MARIAM]!;
    const res = await w.json<{ items: { unitId: string }[] }>(
      `/api/owner/cheques?ownerId=${mariamId}&limit=100`,
      { token: khalid },
    );
    const mine = new Set(await unitsOf(KHALID));
    for (const c of res.body.items) expect(mine.has(c.unitId)).toBe(true);
  });
});
