/**
 * Paths that had no test: contract lists with every filter and paging, termination and renewal,
 * the owner's own settings, files and push token, dispute details, and the Worker entry (refusal
 * when misconfigured, the daily cron).
 */
import { and, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
let editor: string;
let admin: string;
beforeAll(async () => {
  w = await createWorld();
  editor = await w.staffToken('entry@vamar.test');
  admin = await w.staffToken('admin@vamar.test');
});
afterAll(() => w.close());

interface ContractRow {
  id: string;
  unitId: string;
  buildingId: string;
  status: string;
  startDate: string;
  endDate: string;
}
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
const contracts = (query = '') =>
  w.json<Page<ContractRow>>(`/api/staff/contracts${query}`, { token: editor });

describe('contract lists', () => {
  it('filters by status, building, unit and end date, and pages without overlap', async () => {
    const all = await contracts('?limit=100');
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(3);

    const active = await contracts('?status=active&limit=100');
    expect(active.body.items.length).toBeGreaterThan(0);
    expect(active.body.items.every((c) => c.status === 'active')).toBe(true);

    const first = all.body.items[0]!;
    const byBuilding = await contracts(`?buildingId=${first.buildingId}&limit=100`);
    expect(byBuilding.body.items.every((c) => c.buildingId === first.buildingId)).toBe(true);
    const byUnit = await contracts(`?unitId=${first.unitId}&limit=100`);
    expect(byUnit.body.items.every((c) => c.unitId === first.unitId)).toBe(true);

    const ending = await contracts('?endingWithinDays=60&limit=100');
    expect(ending.status).toBe(200);
    for (const c of ending.body.items) {
      expect(c.status).toBe('active');
      expect(c.endDate >= '2026-10-07').toBe(true);
    }

    const page1 = await contracts('?limit=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await contracts(`?limit=2&cursor=${page1.body.nextCursor ?? ''}`);
    const ids1 = page1.body.items.map((c) => c.id);
    expect(page2.body.items.some((c) => ids1.includes(c.id))).toBe(false);

    const bad = await contracts('?endingWithinDays=0');
    expect(bad.status).toBe(422);
  });
});

describe('terminate and renew', () => {
  async function activeContract() {
    const list = await contracts('?status=active&limit=100');
    return list.body.items;
  }

  it('terminating cancels the cheques not yet deposited, once', async () => {
    const [target] = await activeContract();
    const r = await w.json<{ status: string }>(`/api/staff/contracts/${target!.id}/terminate`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ reason: 'tenant left early' }),
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('terminated');
    const left = await w.db
      .select({ id: schema.cheques.id })
      .from(schema.cheques)
      .where(and(eq(schema.cheques.contractId, target!.id), eq(schema.cheques.status, 'upcoming')));
    expect(left).toHaveLength(0);
    const events = await w.db
      .select({ note: schema.chequeEvents.note })
      .from(schema.chequeEvents)
      .innerJoin(schema.cheques, eq(schema.cheques.id, schema.chequeEvents.chequeId))
      .where(
        and(
          eq(schema.cheques.contractId, target!.id),
          eq(schema.chequeEvents.toStatus, 'cancelled'),
        ),
      );
    for (const e of events) expect(e.note).toContain('tenant left early');

    const again = await w.request(`/api/staff/contracts/${target!.id}/terminate`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ reason: 'again' }),
    });
    expect(again.status).toBe(409);
    const missing = await w.request(`/api/staff/contracts/${crypto.randomUUID()}/terminate`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ reason: 'none' }),
    });
    expect(missing.status).toBe(404);
  });

  it('renewing makes one draft that starts the day after the old end', async () => {
    const list = await activeContract();
    const drafts = await w.db
      .select({ previous: schema.contracts.previousContractId })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, 'draft'));
    const renewed = new Set(drafts.map((d) => d.previous));
    // An active contract without a renewal draft yet (the seed renews one of them already).
    const old = list.find((c) => !renewed.has(c.id));
    expect(old).toBeDefined();
    if (!old) return;
    const r = await w.json<{ id: string; status: string; startDate: string }>(
      `/api/staff/contracts/${old.id}/renew`,
      { method: 'POST', token: editor },
    );
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('draft');
    const dayAfter = new Date(`${old.endDate}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    expect(r.body.startDate).toBe(dayAfter.toISOString().slice(0, 10));
    const twice = await w.request(`/api/staff/contracts/${old.id}/renew`, {
      method: 'POST',
      token: editor,
    });
    expect(twice.status).toBe(409);
    const ofDraft = await w.request(`/api/staff/contracts/${r.body.id}/renew`, {
      method: 'POST',
      token: editor,
    });
    expect(ofDraft.status).toBe(409);
    const missing = await w.request(`/api/staff/contracts/${crypto.randomUUID()}/renew`, {
      method: 'POST',
      token: editor,
    });
    expect(missing.status).toBe(404);
  });
});

describe('the owner’s own settings, files and push token', () => {
  it('changes the app language', async () => {
    const owner = await w.ownerToken('+971500000001');
    const r = await w.request('/api/owner/me', {
      method: 'PATCH',
      token: owner,
      body: JSON.stringify({ preferredLang: 'en' }),
    });
    expect(r.status).toBe(200);
    const me = await w.json<{ preferredLang: string }>('/api/owner/me', { token: owner });
    expect(me.body.preferredLang).toBe('en');
    const bad = await w.request('/api/owner/me', {
      method: 'PATCH',
      token: owner,
      body: JSON.stringify({ preferredLang: 'fr' }),
    });
    expect(bad.status).toBe(422);
  });

  it('streams a cheque image of its own cheque, 404 when there is none', async () => {
    const owner = await w.ownerToken('+971500000001');
    const list = await w.json<{ items: { id: string }[] }>('/api/owner/cheques?limit=5', {
      token: owner,
    });
    const id = list.body.items[0]!.id;
    expect((await w.request(`/api/owner/cheques/${id}/image`, { token: owner })).status).toBe(404);
    const png = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFF3F0005FE02FEA7D6A9B70000000049454E44AE426082',
      'hex',
    );
    const form = new FormData();
    form.set('file', new Blob([png], { type: 'image/png' }), 'cheque.png');
    const up = await w.request(`/api/staff/cheques/${id}/image`, {
      method: 'POST',
      token: editor,
      body: form,
    });
    expect(up.status).toBe(201);
    const img = await w.request(`/api/owner/cheques/${id}/image`, { token: owner });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('lists the attachments of its own dispute and opens one', async () => {
    const owner = await w.ownerToken('+971500000001');
    const disputes = await w.json<{ items: { id: string }[] }>('/api/owner/disputes', {
      token: owner,
    });
    const dispute = disputes.body.items[0];
    expect(dispute).toBeDefined();
    if (!dispute) return;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const form = new FormData();
    form.set('entityType', 'dispute');
    form.set('entityId', dispute.id);
    form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'notice.pdf');
    const up = await w.json<{ id: string }>('/api/staff/attachments', {
      method: 'POST',
      token: editor,
      body: form,
    });
    expect(up.status).toBe(201);
    const list = await w.json<{ items: { id: string; fileName: string }[] }>(
      `/api/owner/disputes/${dispute.id}/attachments`,
      { token: owner },
    );
    expect(list.body.items.map((a) => a.id)).toContain(up.body.id);
    const file = await w.request(`/api/owner/attachments/${up.body.id}`, { token: owner });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('attachment');
    const detail = await w.json<{ attachments: { id: string }[]; updates: unknown[] }>(
      `/api/staff/disputes/${dispute.id}`,
      { token: editor },
    );
    expect(detail.body.attachments.map((a) => a.id)).toContain(up.body.id);
  });

  it('registers and removes the push token of its own device only', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971500000002' });
    const signIn = await w.json<{ accessToken: string }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({
        firebaseIdToken: fb,
        device: { deviceId: 'push-test-device', platform: 'android', model: 'test' },
      }),
    });
    const token = signIn.body.accessToken;
    const set = await w.request('/api/owner/push-token', {
      method: 'POST',
      token,
      body: JSON.stringify({
        deviceId: 'push-test-device',
        pushToken: 'ExponentPushToken[test-token]',
      }),
    });
    expect(set.status).toBe(200);
    const removed = await w.request('/api/owner/push-token', {
      method: 'DELETE',
      token,
      body: JSON.stringify({ deviceId: 'push-test-device' }),
    });
    expect(removed.status).toBe(200);
    const [device] = await w.db
      .select({ pushToken: schema.devices.pushToken })
      .from(schema.devices)
      .where(eq(schema.devices.deviceId, 'push-test-device'));
    expect(device?.pushToken).toBeNull();
    const unknown = await w.request('/api/owner/push-token', {
      method: 'DELETE',
      token,
      body: JSON.stringify({ deviceId: 'not-my-device-123' }),
    });
    expect(unknown.status).toBe(404);
  });

  it('an admin can read the audit of these changes', async () => {
    const audit = await w.json<{ items: { action: string }[] }>(
      '/api/staff/audit?action=contract.terminate&limit=5',
      { token: admin },
    );
    expect(audit.status).toBe(200);
    expect(audit.body.items.every((a) => a.action === 'contract.terminate')).toBe(true);
  });
});

describe('Worker entry', () => {
  const ctx = (): ExecutionContext & { waits: Promise<unknown>[] } => {
    const waits: Promise<unknown>[] = [];
    return {
      waits,
      waitUntil: (p: Promise<unknown>) => {
        waits.push(p);
      },
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext & { waits: Promise<unknown>[] };
  };

  it('refuses to serve when the configuration is invalid, and serves when it is valid', async () => {
    const bad = await worker.fetch(
      new Request('http://test/healthz'),
      { ...w.env, JWT_SECRET: 'short' },
      ctx(),
    );
    expect(bad.status).toBe(500);
    expect(bad.headers.get('cache-control')).toBe('no-store');
    expect(await bad.json()).toEqual({
      error: { code: 'internal', message: 'Service is not configured' },
    });
    const ok = await worker.fetch(new Request('http://test/healthz'), w.env, ctx());
    expect(ok.status).toBe(200);
  });

  it('runs the daily jobs from the cron, and skips them when misconfigured', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const c1 = ctx();
    worker.scheduled(
      { cron: '0 4 * * *' } as ScheduledController,
      { ...w.env, JWT_SECRET: '' },
      c1,
    );
    expect(c1.waits).toHaveLength(0);
    expect(log.mock.calls.some((args) => String(args[0]).includes('config.invalid'))).toBe(true);
    log.mockRestore();
    const c2 = ctx();
    worker.scheduled({ cron: '0 4 * * *' } as ScheduledController, w.env, c2);
    expect(c2.waits).toHaveLength(1);
    await Promise.all(c2.waits);
  });
});
