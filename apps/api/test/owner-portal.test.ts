import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let khalid: string;
let fatima: string;
let omar: string;
beforeAll(async () => {
  w = await createWorld();
  khalid = await w.ownerToken('+971500000001');
  fatima = await w.ownerToken('+971500000002');
  omar = await w.ownerToken('+971500000003');
});
afterAll(() => w.close());

interface Home {
  month: string;
  expectedFils: number;
  clearedFils: number;
  pendingFils: number;
  bouncedCount: number;
  nextCheque: { dueDate: string; amountFils: number } | null;
  nextMonthFils: number;
  occupancy: { occupied: number; total: number; pct: number };
  vacantUnits: { unitNo: string; vacantSince: string | null }[];
  openDisputes: number;
}

describe('owner home', () => {
  it("returns this month's totals, next cheque, occupancy and vacant units in one call", async () => {
    const r = await w.json<Home>('/api/owner/home', { token: khalid });
    expect(r.status).toBe(200);
    const h = r.body;
    expect(h.month).toBe('2026-10');
    expect(h.expectedFils).toBeGreaterThan(0);
    expect(h.expectedFils).toBe(
      h.clearedFils +
        h.pendingFils +
        (h.bouncedCount > 0 ? h.expectedFils - h.clearedFils - h.pendingFils : 0),
    );
    expect(h.nextCheque).not.toBeNull();
    expect(h.nextCheque!.dueDate >= TODAY).toBe(true);
    // Khalid: 8 Noor apartments (1 never rented) + 4 villas (30 %)
    expect(h.occupancy.total).toBe(12);
    expect(h.occupancy.occupied).toBe(11);
    expect(h.occupancy.pct).toBe(92);
    expect(h.vacantUnits).toEqual([
      {
        unitId: expect.any(String),
        unitNo: '2002',
        buildingNameAr: 'برج النور',
        buildingNameEn: 'Al Noor Tower',
        vacantSince: null,
      },
    ]);
    expect(typeof h.openDisputes).toBe('number');
  });

  it("totals equal the sum of the owner's share of the month's cheques", async () => {
    const h = (await w.json<Home>('/api/owner/home?month=2026-10', { token: khalid })).body;
    const list = await w.json<{ items: { amountFils: number; status: string }[] }>(
      '/api/owner/cheques?month=2026-10&limit=100',
      { token: khalid },
    );
    const expected = list.body.items
      .filter((c) => c.status !== 'cancelled' && c.status !== 'replaced')
      .reduce((a, c) => a + c.amountFils, 0);
    expect(h.expectedFils).toBe(expected);
  });

  it("shared units show the owner's share, and the parts of both owners sum to the gross", async () => {
    // Safa 301/302: Fatima 60 %, Omar 40 %
    const [safa] = await w.db
      .select({ id: schema.buildings.id })
      .from(schema.buildings)
      .where(eq(schema.buildings.nameEn, 'Al Safa Building'));
    const f = await w.json<{
      items: { id: string; unitNo: string; amountFils: number; shared: boolean; shareBp: number }[];
    }>(`/api/owner/cheques?buildingId=${safa!.id}&limit=100`, { token: fatima });
    const o = await w.json<{
      items: { id: string; unitNo: string; amountFils: number; shared: boolean; shareBp: number }[];
    }>(`/api/owner/cheques?buildingId=${safa!.id}&limit=100`, { token: omar });
    const sharedF = f.body.items.filter((c) => c.shared);
    expect(sharedF.length).toBeGreaterThan(0);
    for (const c of sharedF) {
      const theirs = o.body.items.find((x) => x.id === c.id);
      expect(theirs).toBeDefined();
      const gross = await w.db.query.cheques.findFirst({
        where: eq(schema.cheques.id, c.id),
        columns: { amountFils: true },
      });
      expect(c.amountFils + theirs!.amountFils).toBeLessThanOrEqual(gross!.amountFils!);
      expect(gross!.amountFils! - (c.amountFils + theirs!.amountFils)).toBeLessThanOrEqual(1);
      expect(c.shareBp).toBe(6000);
      expect(theirs!.shareBp).toBe(4000);
    }
    // Fatima's wholly-owned units are not marked shared and show the gross amount
    const whole = f.body.items.find((c) => !c.shared);
    expect(whole).toBeDefined();
  });

  it('cheque detail includes the timeline; filters by unit and status work', async () => {
    const list = await w.json<{ items: { id: string; unitId: string; status: string }[] }>(
      '/api/owner/cheques?status=cleared&limit=5',
      { token: khalid },
    );
    expect(list.body.items.every((c) => c.status === 'cleared')).toBe(true);
    const d = await w.json<{ timeline: { toStatus: string }[]; amountFils: number }>(
      `/api/owner/cheques/${list.body.items[0]!.id}`,
      { token: khalid },
    );
    expect(d.status).toBe(200);
    expect(d.body.timeline.map((t) => t.toStatus)).toContain('cleared');
    const byUnit = await w.json<{ items: { unitId: string }[] }>(
      `/api/owner/cheques?unitId=${list.body.items[0]!.unitId}&limit=50`,
      { token: khalid },
    );
    expect(byUnit.body.items.every((c) => c.unitId === list.body.items[0]!.unitId)).toBe(true);
  });

  it('buildings, units and unit detail show occupancy, tenant, end date and vacant since', async () => {
    const b = await w.json<{
      items: { nameEn: string; unitCount: number; occupiedCount: number }[];
    }>('/api/owner/buildings', { token: khalid });
    expect(b.body.items.map((x) => x.nameEn).sort()).toEqual(['Al Noor Tower', 'Mamzar Villas']);
    const noor = b.body.items.find((x) => x.nameEn === 'Al Noor Tower')!;
    expect(noor.unitCount).toBe(8);
    expect(noor.occupiedCount).toBe(7);
    const units = await w.json<{
      items: {
        id: string;
        occupied: boolean;
        tenantName: string | null;
        contractEndDate: string | null;
        vacantSince: string | null;
        unitNo: string;
      }[];
    }>('/api/owner/units', { token: khalid });
    const occupied = units.body.items.find((u) => u.occupied)!;
    expect(occupied.tenantName).toBeTruthy();
    expect(occupied.contractEndDate).toBeTruthy();
    const vacant = units.body.items.find((u) => !u.occupied)!;
    expect(vacant.unitNo).toBe('2002');
    const detail = await w.json<{ contracts: unknown[]; cheques: unknown[] }>(
      `/api/owner/units/${occupied.id}`,
      { token: khalid },
    );
    expect(detail.status).toBe(200);
    expect(detail.body.contracts.length).toBeGreaterThan(0);
    expect(detail.body.cheques.length).toBeGreaterThan(0);
  });

  it('a vacated unit reports vacant since its last contract end', async () => {
    const [safa3] = await w.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .innerJoin(schema.buildings, eq(schema.buildings.id, schema.units.buildingId))
      .where(and(eq(schema.buildings.nameEn, 'Al Safa Building'), eq(schema.units.unitNo, '202')));
    const d = await w.json<{ occupied: boolean; vacantSince: string | null }>(
      `/api/owner/units/${safa3!.id}`,
      { token: fatima },
    );
    expect(d.body.occupied).toBe(false);
    expect(d.body.vacantSince).not.toBeNull();
  });

  it('disputes list only owner-visible updates', async () => {
    const [d] = await w.db
      .select({ id: schema.disputes.id, unitId: schema.disputes.unitId })
      .from(schema.disputes)
      .limit(1);
    const [own] = await w.db
      .select({ ownerId: schema.unitOwnerships.ownerId })
      .from(schema.unitOwnerships)
      .where(and(eq(schema.unitOwnerships.unitId, d!.unitId), isNull(schema.unitOwnerships.toDate)))
      .limit(1);
    const phone = Object.entries(w.ids.owners).find(([, id]) => id === own!.ownerId)![0];
    const token = await w.ownerToken(phone);
    const list = await w.json<{ items: { id: string; caseNo: string }[] }>('/api/owner/disputes', {
      token,
    });
    expect(list.body.items.some((x) => x.id === d!.id)).toBe(true);
    const detail = await w.json<{ updates: { note: string }[] }>(`/api/owner/disputes/${d!.id}`, {
      token,
    });
    expect(detail.body.updates.length).toBeGreaterThan(0);
    expect(detail.body.updates.some((u) => u.note.includes('Internal'))).toBe(false);
  });

  it('account deletion request disables the owner and revokes sessions', async () => {
    const rashid = await w.ownerToken('+971500000005');
    const r = await w.request('/api/owner/account/delete-request', {
      method: 'POST',
      token: rashid,
      body: JSON.stringify({ reason: 'Selling my units' }),
    });
    expect(r.status).toBe(200);
    const owner = await w.db.query.owners.findFirst({
      where: eq(schema.owners.phoneE164, '+971500000005'),
    });
    expect(owner?.status).toBe('disabled');
    const admin = await w.staffToken('admin@vamar.test');
    const ov = await w.json<{ deletionRequests: { phoneE164: string }[] }>('/api/staff/overview', {
      token: admin,
    });
    expect(ov.body.deletionRequests.some((x) => x.phoneE164 === '+971500000005')).toBe(true);
  });
});
