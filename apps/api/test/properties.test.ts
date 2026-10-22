import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
let viewer: string;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
});
afterAll(() => w.close());

const MISSING = '018f3f1e-7b4a-7c1d-9a2b-3c4d5e6f7a8b';
const send = (method: string, path: string, body: unknown, token = editor) =>
  w.json<Record<string, unknown> & { error?: { code: string } }>(path, {
    method,
    token,
    body: JSON.stringify(body),
  });

describe('buildings, units and tenants', () => {
  let buildingId = '';
  let unitId = '';

  it('creates and renames a building', async () => {
    const created = await send('POST', '/api/staff/buildings', {
      nameAr: 'برج الاختبار',
      nameEn: 'Test Tower',
      area: 'ديرة',
    });
    expect(created.status).toBe(201);
    buildingId = String(created.body['id']);

    const renamed = await send('PATCH', `/api/staff/buildings/${buildingId}`, {
      nameEn: 'Test Tower 2',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body['nameEn']).toBe('Test Tower 2');
    expect(renamed.body['nameAr']).toBe('برج الاختبار');

    const found = await w.json<{ items: { id: string }[] }>(
      '/api/staff/buildings?search=Test%20Tower%202',
      { token: viewer },
    );
    expect(found.body.items.map((b) => b.id)).toContain(buildingId);
  });

  it('404s a building that does not exist', async () => {
    expect((await send('PATCH', `/api/staff/buildings/${MISSING}`, { area: 'x' })).status).toBe(
      404,
    );
    expect((await w.request(`/api/staff/buildings/${MISSING}`, { token: viewer })).status).toBe(
      404,
    );
  });

  it('creates a unit, refuses a duplicate number and a missing building', async () => {
    const unit = { buildingId, unitNo: '101', type: 'apartment', bedrooms: 1 };
    const created = await send('POST', '/api/staff/units', unit);
    expect(created.status).toBe(201);
    unitId = String(created.body['id']);

    const dup = await send('POST', '/api/staff/units', unit);
    expect(dup.status).toBe(409);

    const orphan = await send('POST', '/api/staff/units', { ...unit, buildingId: MISSING });
    expect(orphan.status).toBe(404);
  });

  it('updates a unit and shows it in the building', async () => {
    const r = await send('PATCH', `/api/staff/units/${unitId}`, { sizeSqft: 900, active: true });
    expect(r.status).toBe(200);
    expect(r.body['sizeSqft']).toBe(900);
    expect((await send('PATCH', `/api/staff/units/${MISSING}`, { sizeSqft: 1 })).status).toBe(404);

    const detail = await w.json<{ units: { id: string; occupied: boolean }[] }>(
      `/api/staff/buildings/${buildingId}`,
      { token: viewer },
    );
    expect(detail.body.units).toEqual([expect.objectContaining({ id: unitId, occupied: false })]);
  });

  it('sets owners: shares must total 100 % and owners must exist', async () => {
    const a = w.ids.owners['+971500000001']!;
    const b = w.ids.owners['+971500000002']!;
    const path = `/api/staff/units/${unitId}/owners`;

    const short = await send('PUT', path, {
      fromDate: '2026-01-01',
      owners: [{ ownerId: a, shareBp: 6000 }],
    });
    expect(short.status).toBe(422);
    expect(short.body.error?.code).toBe('shares_invalid');

    const ghost = await send('PUT', path, {
      fromDate: '2026-01-01',
      owners: [{ ownerId: MISSING, shareBp: 10000 }],
    });
    expect(ghost.status).toBe(404);

    const missingUnit = await send('PUT', `/api/staff/units/${MISSING}/owners`, {
      fromDate: '2026-01-01',
      owners: [{ ownerId: a, shareBp: 10000 }],
    });
    expect(missingUnit.status).toBe(404);

    expect(
      (
        await send('PUT', path, {
          fromDate: '2026-01-01',
          owners: [{ ownerId: a, shareBp: 10000 }],
        })
      ).status,
    ).toBe(200);
    // A new set closes the previous one: only the new owners are current.
    const split = await send('PUT', path, {
      fromDate: '2026-06-01',
      owners: [
        { ownerId: a, shareBp: 5000 },
        { ownerId: b, shareBp: 5000 },
      ],
    });
    expect(split.status).toBe(200);

    const unit = await w.json<{ owners: { ownerId: string; shareBp: number }[] }>(
      `/api/staff/units/${unitId}`,
      { token: viewer },
    );
    expect(unit.body.owners.map((o) => o.shareBp)).toEqual([5000, 5000]);
    expect((await w.request(`/api/staff/units/${MISSING}`, { token: viewer })).status).toBe(404);
  });

  it('creates, finds and edits a tenant', async () => {
    const created = await send('POST', '/api/staff/tenants', {
      name: 'Zeta Trading LLC',
      company: 'Zeta Trading',
    });
    expect(created.status).toBe(201);
    const id = String(created.body['id']);

    const found = await w.json<{ items: { id: string }[] }>('/api/staff/tenants?search=zeta', {
      token: viewer,
    });
    expect(found.body.items.map((t) => t.id)).toEqual([id]);
    const all = await w.json<{ items: unknown[] }>('/api/staff/tenants', { token: viewer });
    expect(all.body.items.length).toBeGreaterThan(1);

    const edited = await send('PATCH', `/api/staff/tenants/${id}`, { phone: '+971551112222' });
    expect(edited.body['phone']).toBe('+971551112222');
    expect((await send('PATCH', `/api/staff/tenants/${MISSING}`, { name: 'x' })).status).toBe(404);
  });

  it('a viewer cannot change anything', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/staff/buildings', { nameAr: 'x', nameEn: 'x', area: 'x' }],
      ['PATCH', `/api/staff/buildings/${buildingId}`, { area: 'x' }],
      ['PATCH', `/api/staff/units/${unitId}`, { sizeSqft: 1 }],
      ['POST', '/api/staff/tenants', { name: 'x' }],
    ] as const) {
      expect((await send(method, path, body, viewer)).status).toBe(403);
    }
  });
});
