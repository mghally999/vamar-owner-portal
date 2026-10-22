/**
 * Lists that used to return everything now page with keyset cursors while keeping `items` for the
 * installed app, and the overview keeps its shape with capped lists.
 */
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OVERVIEW_LIST_LIMIT } from '../src/services/overview.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
});
afterAll(() => w.close());

describe('staff lists', () => {
  it('buildings page by name with search', async () => {
    const all = await w.json<{
      items: { id: string; nameEn: string }[];
      nextCursor: string | null;
    }>('/api/staff/buildings', { token: admin });
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(2);
    expect(all.body.nextCursor).toBeNull();
    const first = await w.json<{ items: { id: string }[]; nextCursor: string | null }>(
      '/api/staff/buildings?limit=2',
      { token: admin },
    );
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await w.json<{ items: { id: string }[] }>(
      `/api/staff/buildings?limit=2&cursor=${first.body.nextCursor}`,
      { token: admin },
    );
    const seen = new Set(first.body.items.map((b) => b.id));
    expect(second.body.items.every((b) => !seen.has(b.id))).toBe(true);
    const search = await w.json<{ items: { nameEn: string }[] }>(
      '/api/staff/buildings?search=noor',
      { token: admin },
    );
    expect(search.body.items.every((b) => /noor/i.test(b.nameEn))).toBe(true);
    expect(search.body.items.length).toBeGreaterThan(0);
  });

  it('disputes page newest first', async () => {
    const [unit] = await w.db.select({ id: schema.units.id }).from(schema.units).limit(1);
    for (let i = 0; i < 3; i++) {
      const r = await w.request('/api/staff/disputes', {
        method: 'POST',
        token: admin,
        body: JSON.stringify({ unitId: unit!.id, type: 'other', notes: `Case ${i}` }),
      });
      expect(r.status).toBe(201);
    }
    const first = await w.json<{
      items: { id: string; openedAt: string }[];
      nextCursor: string | null;
    }>('/api/staff/disputes?limit=2', { token: admin });
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    expect(first.body.items[0]!.openedAt >= first.body.items[1]!.openedAt).toBe(true);
    const rest = await w.json<{ items: { id: string }[] }>(
      `/api/staff/disputes?limit=50&cursor=${first.body.nextCursor}`,
      { token: admin },
    );
    const seen = new Set(first.body.items.map((d) => d.id));
    expect(rest.body.items.every((d) => !seen.has(d.id))).toBe(true);
  });

  it('overview runs its lists with a cap and keeps its shape', async () => {
    const r = await w.json<{
      dueSoon: unknown[];
      bounced: unknown[];
      endingSoon: unknown[];
      occupancy: { total: number; occupied: number };
      expectedFils: number;
    }>('/api/staff/overview', { token: admin });
    expect(r.status).toBe(200);
    expect(r.body.dueSoon.length).toBeLessThanOrEqual(OVERVIEW_LIST_LIMIT);
    expect(r.body.bounced.length).toBeLessThanOrEqual(OVERVIEW_LIST_LIMIT);
    expect(r.body.occupancy.total).toBeGreaterThan(0);
    expect(r.body.occupancy.occupied).toBeLessThanOrEqual(r.body.occupancy.total);
    expect(typeof r.body.expectedFils).toBe('number');
  });
});

describe('owner lists', () => {
  it('units keep `items` and report truncation; disputes page', async () => {
    const owner = await w.ownerToken('+971500000001');
    const units = await w.json<{ items: { id: string }[]; truncated: boolean }>(
      '/api/owner/units',
      { token: owner },
    );
    expect(units.status).toBe(200);
    expect(units.body.items.length).toBeGreaterThan(0);
    expect(units.body.truncated).toBe(false);
    const detail = await w.json<{
      id: string;
      cheques: unknown[];
      chequesNextCursor: string | null;
    }>(`/api/owner/units/${units.body.items[0]!.id}`, { token: owner });
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(units.body.items[0]!.id);
    const disputes = await w.json<{ items: unknown[]; nextCursor: string | null }>(
      '/api/owner/disputes?limit=1',
      { token: owner },
    );
    expect(disputes.status).toBe(200);
    expect(disputes.body.items.length).toBeLessThanOrEqual(1);
  });
});
