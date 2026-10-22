/**
 * The owner's phone is the login identity: only an admin changes it, with a reason, and every
 * session and device of the old number is signed out.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forgetSession } from '../src/auth/middleware.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

describe('owner phone change', () => {
  it('editors cannot change it through the generic update, admins change it with a reason', async () => {
    const editor = await w.staffToken('entry@vamar.test');
    const admin = await w.staffToken('admin@vamar.test');
    const phone = '+971500000005';
    const ownerId = w.ids.owners[phone]!;
    const ownerToken = await w.ownerToken(phone);
    expect((await w.request('/api/owner/me', { token: ownerToken })).status).toBe(200);

    const viaPatch = await w.json<{ phoneE164: string }>(`/api/staff/owners/${ownerId}`, {
      method: 'PATCH',
      token: editor,
      body: JSON.stringify({ phoneE164: '+971509999999', nameEn: 'Rashid B.' }),
    });
    expect(viaPatch.status).toBe(200);
    expect(viaPatch.body.phoneE164).toBe(phone);

    const asEditor = await w.request(`/api/staff/owners/${ownerId}/phone`, {
      method: 'POST',
      token: editor,
      body: JSON.stringify({ phoneE164: '+971509999999', reason: 'New SIM card' }),
    });
    expect(asEditor.status).toBe(403);

    const noReason = await w.json<{ error: { code: string } }>(
      `/api/staff/owners/${ownerId}/phone`,
      {
        method: 'POST',
        token: admin,
        body: JSON.stringify({ phoneE164: '+971509999999' }),
      },
    );
    expect(noReason.status).toBe(422);

    const taken = await w.json<{ error: { code: string } }>(`/api/staff/owners/${ownerId}/phone`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ phoneE164: '+971500000001', reason: 'typo' }),
    });
    expect(taken.status).toBe(409);

    const ok = await w.json<{ phoneE164: string }>(`/api/staff/owners/${ownerId}/phone`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ phoneE164: '+971509999999', reason: 'New SIM card' }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.phoneE164).toBe('+971509999999');

    forgetSession();
    expect((await w.request('/api/owner/me', { token: ownerToken })).status).toBe(401);
    const live = await w.db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(and(eq(schema.devices.ownerId, ownerId), isNull(schema.devices.revokedAt)));
    expect(live).toHaveLength(0);
    const [auditRow] = await w.db
      .select({ after: schema.auditLog.after })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'owner.phone_change'),
          eq(schema.auditLog.entityId, ownerId),
        ),
      );
    expect((auditRow?.after as { reason: string }).reason).toBe('New SIM card');
  });
});
