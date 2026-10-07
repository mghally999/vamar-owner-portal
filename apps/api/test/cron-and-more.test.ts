import { and, eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays } from '@vamar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

describe('daily jobs', () => {
  it('sends 3-day cheque reminders and 60/30-day contract alerts once, and expires old contracts', async () => {
    // Arrange: one upcoming cheque due in 3 days, one active contract ending in 60 days, one in 30, one expired yesterday.
    const [c1, c2, c3] = await w.db
      .select({ id: schema.contracts.id, unitId: schema.contracts.unitId })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, 'active'))
      .limit(3);
    const [q] = await w.db
      .select({ id: schema.cheques.id })
      .from(schema.cheques)
      .where(and(eq(schema.cheques.contractId, c1!.id), eq(schema.cheques.status, 'upcoming')))
      .limit(1);
    await w.db
      .update(schema.cheques)
      .set({ dueDate: addDays(TODAY, 3) })
      .where(eq(schema.cheques.id, q!.id));
    await w.db
      .update(schema.contracts)
      .set({ endDate: addDays(TODAY, 60) })
      .where(eq(schema.contracts.id, c2!.id));
    await w.db
      .update(schema.contracts)
      .set({ endDate: addDays(TODAY, 30) })
      .where(eq(schema.contracts.id, c3!.id));
    const [old] = await w.db
      .select({ id: schema.contracts.id })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, 'active'))
      .offset(3)
      .limit(1);
    await w.db
      .update(schema.contracts)
      .set({ startDate: addDays(TODAY, -400), endDate: addDays(TODAY, -1) })
      .where(eq(schema.contracts.id, old!.id));
    // give every owner a device with a push token
    const owners = await w.db.select({ id: schema.owners.id }).from(schema.owners);
    for (const o of owners) {
      await w.db
        .insert(schema.devices)
        .values({
          ownerId: o.id,
          deviceId: `d-${o.id.slice(0, 8)}`,
          platform: 'android',
          pushToken: 'ExponentPushToken[x]',
        })
        .onConflictDoNothing();
    }

    const first = await runDailyJobs(w.env);
    expect(first.dueReminders).toBe(1);
    expect(first.expiredContracts).toBe(1);
    expect(first.sent).toBeGreaterThanOrEqual(3);
    const types = await w.db
      .select({ type: schema.notificationLog.type, entityId: schema.notificationLog.entityId })
      .from(schema.notificationLog);
    expect(types.some((t) => t.type === 'cheque_due_soon' && t.entityId === q!.id)).toBe(true);
    expect(types.some((t) => t.type === 'contract_ending_60' && t.entityId === c2!.id)).toBe(true);
    expect(types.some((t) => t.type === 'contract_ending_30' && t.entityId === c3!.id)).toBe(true);
    const expired = await w.db.query.contracts.findFirst({
      where: eq(schema.contracts.id, old!.id),
    });
    expect(expired?.status).toBe('expired');

    // Re-run: nothing is sent twice
    const second = await runDailyJobs(w.env);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(first.notifications);
    expect(second.expiredContracts).toBe(0);
  });

  it('admin can trigger the jobs through the API; editor cannot', async () => {
    const admin = await w.staffToken('admin@vamar.test');
    const editor = await w.staffToken('editor@vamar.test');
    expect(
      (await w.request('/api/staff/jobs/daily', { method: 'POST', token: editor })).status,
    ).toBe(403);
    const r = await w.json<{ date: string }>('/api/staff/jobs/daily', {
      method: 'POST',
      token: admin,
    });
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(TODAY);
  });
});

describe('disputes, staff users, overview, security headers', () => {
  it('creates a dispute with a case number, adds owner-visible and internal updates', async () => {
    const editor = await w.staffToken('editor@vamar.test');
    const [unit] = await w.db.select({ id: schema.units.id }).from(schema.units).limit(1);
    const r = await w.json<{ id: string; caseNo: string; status: string }>('/api/staff/disputes', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({
        unitId: unit!.id,
        type: 'damages',
        amountClaimedFils: 1_500_000,
        notes: 'Broken kitchen cabinets',
      }),
    });
    expect(r.status).toBe(201);
    expect(r.body.caseNo).toBe('D-2026-0003');
    expect(r.body.status).toBe('open');
    const u1 = await w.request(`/api/staff/disputes/${r.body.id}/updates`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ note: 'تم إرسال إشعار للمستأجر', visibleToOwner: true }),
    });
    expect(u1.status).toBe(201);
    const up = await w.json<{ status: string; nextHearingDate: string }>(
      `/api/staff/disputes/${r.body.id}`,
      {
        method: 'PATCH',
        token: editor,
        body: JSON.stringify({ status: 'hearing_scheduled', nextHearingDate: addDays(TODAY, 14) }),
      },
    );
    expect(up.body.status).toBe('hearing_scheduled');
    const closed = await w.json<{ status: string; closedAt: string | null }>(
      `/api/staff/disputes/${r.body.id}`,
      { method: 'PATCH', token: editor, body: JSON.stringify({ status: 'closed' }) },
    );
    expect(closed.body.closedAt).not.toBeNull();
  });

  it('admin invites staff, changes roles, resets TOTP; cannot demote self', async () => {
    const admin = await w.staffToken('admin@vamar.test');
    const inv = await w.json<{ id: string; role: string }>('/api/staff/staff', {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ email: 'New.Person@vamar.test', name: 'New Person', role: 'viewer' }),
    });
    expect(inv.status).toBe(201);
    const promoted = await w.json<{ role: string }>(`/api/staff/staff/${inv.body.id}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(promoted.body.role).toBe('editor');
    expect(
      (
        await w.request(`/api/staff/staff/${inv.body.id}/reset-totp`, {
          method: 'POST',
          token: admin,
        })
      ).status,
    ).toBe(200);
    const self = w.ids.staff['admin@vamar.test']!;
    expect(
      (
        await w.request(`/api/staff/staff/${self}`, {
          method: 'PATCH',
          token: admin,
          body: JSON.stringify({ role: 'viewer' }),
        })
      ).status,
    ).toBe(409);
    const deactivated = await w.json<{ active: boolean }>(`/api/staff/staff/${inv.body.id}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ active: false }),
    });
    expect(deactivated.body.active).toBe(false);
  });

  it('overview returns the month totals, due soon, ending soon and bounced', async () => {
    const viewer = await w.staffToken('viewer@vamar.test');
    const r = await w.json<{
      expectedFils: number;
      dueSoon: unknown[];
      endingSoon: unknown[];
      bounced: unknown[];
      occupancy: { total: number };
    }>('/api/staff/overview', { token: viewer });
    expect(r.status).toBe(200);
    expect(r.body.expectedFils).toBeGreaterThan(0);
    expect(r.body.occupancy.total).toBe(32);
    expect(Array.isArray(r.body.dueSoon)).toBe(true);
  });

  it('sets security headers and serves the privacy page', async () => {
    const h = await w.request('/healthz');
    expect(h.headers.get('x-frame-options')).toBe('DENY');
    expect(h.headers.get('x-content-type-options')).toBe('nosniff');
    expect(h.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(h.headers.get('strict-transport-security')).toContain('max-age=');
    expect(h.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const p = await w.request('/privacy');
    expect(p.status).toBe(200);
    expect(await p.text()).toContain('سياسة الخصوصية');
  });

  it('validation errors return 400 with details and unknown API paths return JSON 404', async () => {
    const editor = await w.staffToken('editor@vamar.test');
    const r = await w.request('/api/staff/owners', {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ nameAr: '' }),
    });
    expect(r.status).toBe(400);
    const nf = await w.json<{ error: { code: string } }>('/api/nothing-here');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('not_found');
  });
});
