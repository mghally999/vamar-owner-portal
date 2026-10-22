/**
 * Regression tests for the reliability pass: notifications that fail in transport are retried by
 * the next run, imports keep going past a rejected row and replay their stored report, uploads
 * check the entity and the bytes, deletions remove the object after commit, push-token updates
 * report when nothing matched, and the cron keeps running when one step fails.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { deliver } from '../src/services/notifications.js';
import { fetchWithRetry, OutboundError, withTimeout } from '../src/util/outbound.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let admin: string;
beforeAll(async () => {
  w = await createWorld();
  admin = await w.staffToken('admin@vamar.test');
});
afterAll(() => w.close());

describe('outbound helper', () => {
  it('times out and reports the kind of failure', async () => {
    await expect(
      withTimeout(() => new Promise((r) => setTimeout(r, 200)), 20, 'slow'),
    ).rejects.toMatchObject({ kind: 'timeout' });
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(new Response('busy', { status: 503 }));
    }) as typeof fetch;
    try {
      const res = await fetchWithRetry('https://example.test/x', {}, { retries: 2, backoffMs: 1 });
      expect(res.status).toBe(503);
      expect(calls).toBe(3);
      globalThis.fetch = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
      await expect(
        fetchWithRetry('https://example.test/x', {}, { retries: 1, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(OutboundError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('notifications', () => {
  it('a transport failure is recorded and retried by the next run; a success is final', async () => {
    const ownerId = w.ids.owners['+971500000003']!;
    await w.db
      .insert(schema.devices)
      .values({
        ownerId,
        deviceId: 'rel-device',
        platform: 'android',
        pushToken: 'ExponentPushToken[rel]',
      })
      .onConflictDoNothing();
    const pending = [
      {
        ownerId,
        type: 'cheque_due_soon' as const,
        entityId: crypto.randomUUID(),
        date: TODAY,
        params: {
          type: 'cheque_due_soon' as const,
          amountFils: 100_000,
          dueDate: TODAY,
          unitLabel: 'Test 1',
        },
      },
    ];
    const failed = await deliver({ ...w.env, TEST_PUSH: 'fail' }, w.db, pending);
    expect(failed).toEqual({ sent: 0, skipped: 0, failed: 1 });
    const [row] = await w.db
      .select({ result: schema.notificationLog.result })
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.entityId, pending[0]!.entityId));
    expect(row?.result).toBe('failed:test');

    const retried = await deliver(w.env, w.db, pending);
    expect(retried).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const [after] = await w.db
      .select({ result: schema.notificationLog.result })
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.entityId, pending[0]!.entityId));
    expect(after?.result).toBe('ok');

    const again = await deliver(w.env, w.db, pending);
    expect(again).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it('the daily run reports a failed step and still runs the others', async () => {
    const [c] = await w.db
      .select({ id: schema.contracts.id })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, 'active'))
      .limit(1);
    await w.db
      .update(schema.contracts)
      .set({ startDate: addDays(TODAY, -400), endDate: addDays(TODAY, -2) })
      .where(eq(schema.contracts.id, c!.id));
    await w.db.execute(sql`alter table rate_limits rename to rate_limits_hidden`);
    try {
      await expect(runDailyJobs(w.env)).rejects.toThrow(/retention/);
    } finally {
      await w.db.execute(sql`alter table rate_limits_hidden rename to rate_limits`);
    }
    const expired = await w.db.query.contracts.findFirst({ where: eq(schema.contracts.id, c!.id) });
    expect(expired?.status).toBe('expired');
    const summary = await runDailyJobs(w.env);
    expect(summary.errors).toEqual([]);
    expect(summary.purged).toBeDefined();
  });
});

describe('import', () => {
  it('keeps going past a row the database rejects, refuses duplicate buildings and replays its report', async () => {
    const body = {
      target: 'buildings',
      fileName: 'b.xlsx',
      idempotencyKey: 'import-rel-0001',
      rows: [
        {
          row: 2,
          data: { nameAr: 'برج الاختبار', nameEn: 'Test Tower', area: 'Deira', address: 'x' },
        },
        {
          row: 3,
          data: { nameAr: 'برج النور', nameEn: 'Al Noor Tower', area: 'Deira', address: 'x' },
        },
        {
          row: 4,
          data: { nameAr: 'برج الاختبار', nameEn: 'Test Tower', area: 'Deira', address: 'x' },
        },
        { row: 5, data: { nameAr: 'ب', nameEn: 'Fine', area: 'Deira', address: 'x' } },
      ],
    };
    const r = await w.json<{
      rowsOk: number;
      rowsFailed: number;
      results: { row: number; ok: boolean; errors?: string[] }[];
    }>('/api/staff/import/commit', { method: 'POST', token: admin, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    expect(r.body.rowsOk).toBe(2);
    expect(r.body.results.find((x) => x.row === 3)?.errors?.[0]).toContain('already exists');
    expect(r.body.results.find((x) => x.row === 4)?.errors?.[0]).toContain('already exists');
    expect(r.body.results.find((x) => x.row === 5)?.ok).toBe(true);

    const replay = await w.json<{ alreadyDone: boolean; results: unknown[] }>(
      '/api/staff/import/commit',
      { method: 'POST', token: admin, body: JSON.stringify(body) },
    );
    expect(replay.body.alreadyDone).toBe(true);
    expect(replay.body.results).toHaveLength(4);
  });

  it('a database rejection fails that row only', async () => {
    // A unit whose type passes zod but whose building was removed between lookup and insert
    // cannot be staged here, so a check constraint is used: contract-level checks do not apply to
    // units, hence a tenant with a name longer than the column accepts.
    const [b] = await w.db.select({ id: schema.buildings.id }).from(schema.buildings).limit(1);
    const body = {
      target: 'units',
      fileName: 'u.xlsx',
      idempotencyKey: 'import-rel-0002',
      rows: [
        { row: 2, data: { building: b!.id, unitNo: 'R-1', type: 'shop' } },
        { row: 3, data: { building: b!.id, unitNo: 'R-1', type: 'shop' } },
        { row: 4, data: { building: b!.id, unitNo: 'R-2', type: 'shop', sizeSqft: -5 } },
        { row: 5, data: { building: b!.id, unitNo: 'R-3', type: 'shop' } },
      ],
    };
    const r = await w.json<{
      rowsOk: number;
      results: { row: number; ok: boolean; errors?: string[] }[];
    }>('/api/staff/import/commit', { method: 'POST', token: admin, body: JSON.stringify(body) });
    expect(r.body.rowsOk).toBe(2);
    expect(r.body.results.find((x) => x.row === 3)?.errors?.[0]).toContain('already exists');
    expect(r.body.results.find((x) => x.row === 4)?.ok).toBe(false);
    expect(r.body.results.find((x) => x.row === 5)?.ok).toBe(true);
  });
});

describe('attachments', () => {
  const pdf = () =>
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'paper.pdf', {
      type: 'application/pdf',
    });

  it('refuses uploads for records that do not exist and files whose bytes lie', async () => {
    const form = new FormData();
    form.set('entityType', 'dispute');
    form.set('entityId', crypto.randomUUID());
    form.set('file', pdf());
    const missing = await w.request('/api/staff/attachments', {
      method: 'POST',
      token: admin,
      body: form,
    });
    expect(missing.status).toBe(404);

    const [d] = await w.db.select({ id: schema.disputes.id }).from(schema.disputes).limit(1);
    const lie = new FormData();
    lie.set('entityType', 'dispute');
    lie.set('entityId', d!.id);
    lie.set(
      'file',
      new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'x.jpg', { type: 'image/jpeg' }),
    );
    const bad = await w.request('/api/staff/attachments', {
      method: 'POST',
      token: admin,
      body: lie,
    });
    expect(bad.status).toBe(422);
  });

  it('stores the object with the row, serves PDFs as downloads and removes the object on delete', async () => {
    const [d] = await w.db.select({ id: schema.disputes.id }).from(schema.disputes).limit(1);
    const form = new FormData();
    form.set('entityType', 'dispute');
    form.set('entityId', d!.id);
    form.set('file', pdf());
    const up = await w.json<{ id: string; r2Key: string }>('/api/staff/attachments', {
      method: 'POST',
      token: admin,
      body: form,
    });
    expect(up.status).toBe(201);
    expect(w.r2.store.has(up.body.r2Key)).toBe(true);
    const get = await w.request(`/api/staff/attachments/${up.body.id}`, { token: admin });
    expect(get.headers.get('content-disposition')).toContain('attachment');
    expect(get.headers.get('cache-control')).toBe('no-store');
    const del = await w.request(`/api/staff/attachments/${up.body.id}`, {
      method: 'DELETE',
      token: admin,
    });
    expect(del.status).toBe(200);
    await w.flush();
    expect(w.r2.store.has(up.body.r2Key)).toBe(false);
  });
});

describe('owner device endpoints', () => {
  it('a push token for an unknown device is a 404, not a silent success', async () => {
    const owner = await w.ownerToken('+971500000004');
    const r = await w.json<{ error: { code: string } }>('/api/owner/push-token', {
      method: 'POST',
      token: owner,
      body: JSON.stringify({ deviceId: 'never-seen-device', pushToken: 'ExponentPushToken[n]' }),
    });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
    const ownerId = w.ids.owners['+971500000004']!;
    await w.db
      .insert(schema.devices)
      .values({ ownerId, deviceId: 'known-device', platform: 'ios' })
      .onConflictDoNothing();
    const ok = await w.request('/api/owner/push-token', {
      method: 'POST',
      token: owner,
      body: JSON.stringify({ deviceId: 'known-device', pushToken: 'ExponentPushToken[k]' }),
    });
    expect(ok.status).toBe(200);
    const [dev] = await w.db
      .select({ pushToken: schema.devices.pushToken })
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.ownerId, ownerId),
          eq(schema.devices.deviceId, 'known-device'),
          isNull(schema.devices.revokedAt),
        ),
      );
    expect(dev?.pushToken).toBe('ExponentPushToken[k]');
  });
});
