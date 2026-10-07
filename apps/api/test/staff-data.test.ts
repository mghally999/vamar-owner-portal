import { eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
let admin: string;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('editor@vamar.test');
  admin = await w.staffToken('admin@vamar.test');
});
afterAll(() => w.close());

const post = (path: string, body: unknown, token = editor) =>
  w.json<Record<string, unknown> & { id: string }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    token,
  });
const put = (path: string, body: unknown, token = editor) =>
  w.json<{ items: unknown[] }>(path, { method: 'PUT', body: JSON.stringify(body), token });
const patch = (path: string, body: unknown, token = editor) =>
  w.json<Record<string, unknown>>(path, { method: 'PATCH', body: JSON.stringify(body), token });

describe('owners, buildings, units, shares', () => {
  let ownerA: string;
  let ownerB: string;
  let buildingId: string;
  let unitId: string;

  it('creates owners and refuses duplicate phones', async () => {
    const a = await post('/api/staff/owners', {
      nameAr: 'سعيد المهيري',
      nameEn: 'Saeed Al Muhairi',
      phoneE164: '+971507000001',
    });
    expect(a.status).toBe(201);
    ownerA = a.body.id;
    const b = await post('/api/staff/owners', {
      nameAr: 'نورة الكعبي',
      nameEn: 'Noura Al Kaabi',
      phoneE164: '+971507000002',
      preferredLang: 'en',
    });
    ownerB = b.body.id;
    const dup = await post('/api/staff/owners', {
      nameAr: 'x',
      nameEn: 'x',
      phoneE164: '+971507000001',
    });
    expect(dup.status).toBe(409);
    const bad = await post('/api/staff/owners', {
      nameAr: 'x',
      nameEn: 'x',
      phoneE164: '0507000001',
    });
    expect(bad.status).toBe(400);
  });

  it('creates a building and unit; unit numbers are unique per building', async () => {
    const b = await post('/api/staff/buildings', {
      nameAr: 'برج الاختبار',
      nameEn: 'Test Tower',
      area: 'JVC, Dubai',
    });
    expect(b.status).toBe(201);
    buildingId = b.body.id;
    const u = await post('/api/staff/units', {
      buildingId,
      unitNo: '101',
      type: 'apartment',
      bedrooms: 2,
      sizeSqft: 1200,
    });
    expect(u.status).toBe(201);
    unitId = u.body.id;
    expect(
      (await post('/api/staff/units', { buildingId, unitNo: '101', type: 'apartment' })).status,
    ).toBe(409);
  });

  it('assigns owners with shares that must sum to exactly 100%', async () => {
    const short = await put(`/api/staff/units/${unitId}/owners`, {
      fromDate: '2026-01-01',
      owners: [
        { ownerId: ownerA, shareBp: 6000 },
        { ownerId: ownerB, shareBp: 3000 },
      ],
    });
    expect(short.status).toBe(422);
    const over = await put(`/api/staff/units/${unitId}/owners`, {
      fromDate: '2026-01-01',
      owners: [
        { ownerId: ownerA, shareBp: 6000 },
        { ownerId: ownerB, shareBp: 5000 },
      ],
    });
    expect(over.status).toBe(422);
    const ok = await put(`/api/staff/units/${unitId}/owners`, {
      fromDate: '2026-01-01',
      owners: [
        { ownerId: ownerA, shareBp: 6000 },
        { ownerId: ownerB, shareBp: 4000 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.items).toHaveLength(2);
    // replacing closes the old rows
    const again = await put(`/api/staff/units/${unitId}/owners`, {
      fromDate: '2026-06-01',
      owners: [{ ownerId: ownerA, shareBp: 10000 }],
    });
    expect(again.status).toBe(200);
    const detail = await w.json<{ owners: { ownerId: string; shareBp: number }[] }>(
      `/api/staff/units/${unitId}`,
      { token: editor },
    );
    expect(detail.body.owners).toEqual([
      {
        ownerId: ownerA,
        shareBp: 10000,
        nameAr: 'سعيد المهيري',
        nameEn: 'Saeed Al Muhairi',
        fromDate: '2026-06-01',
      },
    ]);
    const auditRows = await w.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'unit.set_owners'));
    expect(auditRows.length).toBe(2);
    expect(auditRows[1]!.before).not.toBeNull();
  });

  it('owner detail lists holdings and the owner list paginates by keyset', async () => {
    const d = await w.json<{ holdings: { unitId: string; shareBp: number }[] }>(
      `/api/staff/owners/${ownerA}`,
      { token: editor },
    );
    expect(d.body.holdings).toEqual([expect.objectContaining({ unitId, shareBp: 10000 })]);
    const p1 = await w.json<{ items: { id: string }[]; nextCursor: string | null }>(
      '/api/staff/owners?limit=3',
      { token: editor },
    );
    expect(p1.body.items).toHaveLength(3);
    expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await w.json<{ items: { id: string }[] }>(
      `/api/staff/owners?limit=3&cursor=${p1.body.nextCursor}`,
      { token: editor },
    );
    expect(p2.body.items.length).toBeGreaterThan(0);
    const ids = new Set(p1.body.items.map((i) => i.id));
    for (const i of p2.body.items) expect(ids.has(i.id)).toBe(false);
  });

  it('disabling an owner revokes sessions', async () => {
    const r = await post(`/api/staff/owners/${ownerB}/status`, { status: 'disabled' });
    expect(r.status).toBe(200);
    expect(r.body['status']).toBe('disabled');
  });
});

describe('contracts and the cheque grid', () => {
  let unitId: string;
  let tenantId: string;
  let contractId: string;

  beforeAll(async () => {
    const b = await post('/api/staff/buildings', {
      nameAr: 'بناية العقود',
      nameEn: 'Contracts Building',
      area: 'Al Nahda, Sharjah',
    });
    const u = await post('/api/staff/units', {
      buildingId: b.body.id,
      unitNo: 'A1',
      type: 'apartment',
      bedrooms: 1,
    });
    unitId = u.body.id;
    const t = await post('/api/staff/tenants', { name: 'Test Tenant', phone: '+971521234567' });
    tenantId = t.body.id;
  });

  it('creates a draft with generated dates and empty amounts', async () => {
    const r = await w.json<{
      id: string;
      status: string;
      cheques: { seq: number; dueDate: string; amountFils: number | null }[];
    }>('/api/staff/contracts', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        unitId,
        tenantId,
        startDate: '2026-01-31',
        endDate: '2027-01-30',
        annualRentFils: 12_000_000,
        chequeCount: 4,
      }),
    });
    expect(r.status).toBe(201);
    contractId = r.body.id;
    expect(r.body.status).toBe('draft');
    expect(r.body.cheques.map((c) => c.dueDate)).toEqual([
      '2026-01-31',
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
    expect(r.body.cheques.every((c) => c.amountFils === null)).toBe(true);
  });

  it('refuses activation while amounts are missing, then with a mismatching total without a reason', async () => {
    const a1 = await w.json<{ error: { code: string } }>(
      `/api/staff/contracts/${contractId}/activate`,
      { method: 'POST', token: editor, body: '{}' },
    );
    expect(a1.status).toBe(422);
    expect(a1.body.error.code).toBe('grid_incomplete');

    const grid = (amounts: number[]) =>
      amounts.map((amt, i) => ({
        seq: i + 1,
        dueDate: ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31'][i],
        amountFils: amt,
        chequeNo: `10${i}`,
        bankName: 'ENBD',
      }));
    const up = await patch(`/api/staff/contracts/${contractId}`, {
      cheques: grid([3_000_000, 3_000_000, 3_000_000, 2_500_000]),
    });
    expect(up.status).toBe(200);
    const detail = await w.json<{
      gridValidation: { complete: boolean; matchesRent: boolean; differenceFils: number };
    }>(`/api/staff/contracts/${contractId}`, { token: editor });
    expect(detail.body.gridValidation).toMatchObject({
      complete: true,
      matchesRent: false,
      differenceFils: -500_000,
    });

    const a2 = await w.json<{ error: { code: string } }>(
      `/api/staff/contracts/${contractId}/activate`,
      { method: 'POST', token: editor, body: '{}' },
    );
    expect(a2.body.error.code).toBe('total_mismatch_needs_reason');

    const a3 = await w.json<{ status: string }>(`/api/staff/contracts/${contractId}/activate`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ totalMismatchReason: 'Tenant paid 5,000 AED in cash' }),
    });
    expect(a3.status).toBe(200);
    expect(a3.body.status).toBe('active');
    const auditRow = await w.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'contract.activate'));
    expect(JSON.stringify(auditRow.at(-1)!.after)).toContain('Tenant paid 5,000 AED in cash');
    const events = await w.db
      .select()
      .from(schema.chequeEvents)
      .innerJoin(schema.cheques, eq(schema.cheques.id, schema.chequeEvents.chequeId))
      .where(eq(schema.cheques.contractId, contractId));
    expect(events).toHaveLength(4);
  });

  it('a second overlapping active contract on the same unit is refused', async () => {
    const r = await w.json<{ id: string }>('/api/staff/contracts', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        unitId,
        tenantId,
        startDate: '2026-06-01',
        endDate: '2027-05-31',
        annualRentFils: 1_000_000,
        chequeCount: 1,
        cheques: [
          { seq: 1, dueDate: '2026-06-01', amountFils: 1_000_000, chequeNo: '9', bankName: 'FAB' },
        ],
      }),
    });
    const act = await w.request(`/api/staff/contracts/${r.body.id}/activate`, {
      method: 'POST',
      token: editor,
      body: '{}',
    });
    expect(act.status).toBe(409);
  });

  it('one-click renew creates a linked draft starting the next day', async () => {
    const r = await w.json<{
      id: string;
      status: string;
      startDate: string;
      endDate: string;
      previousContractId: string;
      cheques: unknown[];
    }>(`/api/staff/contracts/${contractId}/renew`, { method: 'POST', token: editor });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('draft');
    expect(r.body.startDate).toBe('2027-01-31');
    expect(r.body.endDate).toBe('2028-01-30');
    expect(r.body.previousContractId).toBe(contractId);
    expect(r.body.cheques).toHaveLength(4);
    expect(
      (
        await w.request(`/api/staff/contracts/${contractId}/renew`, {
          method: 'POST',
          token: editor,
        })
      ).status,
    ).toBe(409);
  });

  it('viewer can read but not write; admin can see audit', async () => {
    const viewer = await w.staffToken('viewer@vamar.test');
    expect((await w.request(`/api/staff/contracts/${contractId}`, { token: viewer })).status).toBe(
      200,
    );
    expect(
      (
        await w.request(`/api/staff/contracts/${contractId}`, {
          method: 'PATCH',
          token: viewer,
          body: JSON.stringify({ notes: 'x' }),
        })
      ).status,
    ).toBe(403);
    const audit = await w.json<{ items: { action: string }[] }>(
      '/api/staff/audit?action=contract.&limit=10',
      { token: admin },
    );
    expect(audit.status).toBe(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(audit.body.items.every((i) => i.action.startsWith('contract.'))).toBe(true);
  });
});
