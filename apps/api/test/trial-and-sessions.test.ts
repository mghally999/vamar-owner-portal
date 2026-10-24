/**
 * The demo-trial rule for 2-step login, single-use pre-auth tokens, revocation that bites at once
 * in the same isolate, and request body limits.
 */
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TRIAL_EMAILS, maySkipTotp } from '../src/config.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

interface Exchange {
  accessToken?: string;
  preAuthToken?: string;
  error?: { code: string };
}

async function exchange(email: string, sub: string, demoTrial: boolean) {
  const fb = await w.firebaseToken({ email, email_verified: true, sub });
  w.env.DEMO_TRIAL = demoTrial ? 'true' : 'false';
  try {
    return await w.json<Exchange>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb }),
    });
  } finally {
    delete w.env.DEMO_TRIAL;
  }
}

async function addStaff(email: string, role: 'admin' | 'editor', totpRequired: boolean) {
  const [row] = await w.db
    .insert(schema.staffUsers)
    .values({
      email,
      name: email,
      role,
      firebaseUid: `invite:${crypto.randomUUID()}`,
      totpRequired,
    })
    .returning({ id: schema.staffUsers.id });
  return row!.id;
}

describe('2-step login and the demo trial', () => {
  it('an admin row with 2-step off is refused a session when DEMO_TRIAL is false', async () => {
    await w.db
      .update(schema.staffUsers)
      .set({ totpRequired: false })
      .where(eq(schema.staffUsers.email, 'admin@vamar.test'));
    const r = await exchange('admin@vamar.test', 'fb-trial-admin', false);
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeUndefined();
    expect(r.body.preAuthToken).toBeTruthy();
  });

  it('the listed demo admin with 2-step off signs in without TOTP while DEMO_TRIAL is true', async () => {
    const r = await exchange('admin@vamar.test', 'fb-trial-admin', true);
    expect(r.status).toBe(200);
    expect(r.body.preAuthToken).toBeUndefined();
    const staff = await w.request('/api/staff/staff', { token: r.body.accessToken ?? '' });
    expect(staff.status).toBe(200);
    await w.db
      .update(schema.staffUsers)
      .set({ totpRequired: true })
      .where(eq(schema.staffUsers.email, 'admin@vamar.test'));
  });

  it('an admin that is not on the list always gets the TOTP step, trial or not', async () => {
    await addStaff('second.admin@vamar.ae', 'admin', false);
    for (const trial of [false, true]) {
      const r = await exchange('second.admin@vamar.ae', 'fb-second-admin', trial);
      expect(r.status).toBe(200);
      expect(r.body.accessToken).toBeUndefined();
      expect(r.body.preAuthToken).toBeTruthy();
    }
  });

  it('a non-listed editor with 2-step off also gets the TOTP step during the trial', async () => {
    await addStaff('data.entry@vamar.ae', 'editor', false);
    const r = await exchange('data.entry@vamar.ae', 'fb-data-entry', true);
    expect(r.body.accessToken).toBeUndefined();
    expect(r.body.preAuthToken).toBeTruthy();
  });

  it('matches the list by e-mail only and needs all three conditions', () => {
    const on = { DEMO_TRIAL: 'true' };
    expect(maySkipTotp(on, { email: 'Admin@Vamar.test ', totpRequired: false })).toBe(true);
    expect(maySkipTotp(on, { email: 'admin@vamar.test', totpRequired: true })).toBe(false);
    expect(
      maySkipTotp({ DEMO_TRIAL: 'false' }, { email: 'admin@vamar.test', totpRequired: false }),
    ).toBe(false);
    expect(maySkipTotp({}, { email: 'entry@vamar.test', totpRequired: false })).toBe(false);
    expect(maySkipTotp(on, { email: 'owner@vamar.ae', totpRequired: false })).toBe(false);
  });

  it('the reset script refuses the same accounts the API does', () => {
    const script = readFileSync(
      new URL('../../../tooling/dev/staff-reset-totp.mjs', import.meta.url),
      'utf8',
    );
    const list = /const DEMO_TRIAL_EMAILS = \[([^\]]*)\]/.exec(script)?.[1] ?? '';
    const emails = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(emails).toEqual([...DEMO_TRIAL_EMAILS]);
    expect(script).toContain('2-step login stays on for admins unless DEMO_TRIAL');
  });
});

describe('revocation bites at once in the same isolate', () => {
  const device = (id: string) => ({ deviceId: id, platform: 'android', model: 'test' });
  async function ownerSignIn(phone: string, deviceId: string) {
    const fb = await w.firebaseToken({ phone_number: phone });
    const r = await w.json<{ accessToken: string; refreshToken: string }>(
      '/api/auth/owner/exchange',
      { method: 'POST', body: JSON.stringify({ firebaseIdToken: fb, device: device(deviceId) }) },
    );
    expect(r.status).toBe(200);
    return r.body;
  }
  const me = (token: string) => w.request('/api/owner/me', { token }).then((r) => r.status);

  it('owner logout', async () => {
    const s = await ownerSignIn('+971500000003', 'device-logout-1');
    expect(await me(s.accessToken)).toBe(200); // now cached as active
    await w.request('/api/auth/owner/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    });
    expect(await me(s.accessToken)).toBe(401);
  });

  it('sign out other devices', async () => {
    const a = await ownerSignIn('+971500000003', 'device-others-a');
    const b = await ownerSignIn('+971500000003', 'device-others-b');
    expect(await me(a.accessToken)).toBe(200);
    const r = await w.request('/api/auth/owner/devices/revoke-others', {
      method: 'POST',
      token: b.accessToken,
    });
    expect(r.status).toBe(200);
    expect(await me(a.accessToken)).toBe(401);
    expect(await me(b.accessToken)).toBe(200);
  });

  it('owner disabled by staff', async () => {
    const s = await ownerSignIn('+971500000005', 'device-disable-1');
    expect(await me(s.accessToken)).toBe(200);
    const admin = await w.staffToken('admin@vamar.test');
    const id = w.ids.owners['+971500000005']!;
    const off = await w.request(`/api/staff/owners/${id}/status`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(off.status).toBe(200);
    expect(await me(s.accessToken)).toBe(401);
    await w.request(`/api/staff/owners/${id}/status`, {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ status: 'active' }),
    });
  });

  it('staff logout-all', async () => {
    const token = await w.staffToken('entry@vamar.test');
    const meStaff = () => w.request('/api/auth/staff/me', { token }).then((r) => r.status);
    expect(await meStaff()).toBe(200);
    await w.request('/api/auth/staff/logout-all', { method: 'POST', token });
    expect(await meStaff()).toBe(401);
  });
});

describe('request body limits', () => {
  it('a 40 MB JSON body gets 413 before it is parsed', async () => {
    const token = await w.staffToken('admin@vamar.test');
    const big = JSON.stringify({
      nameAr: 'a',
      nameEn: 'b',
      area: 'c',
      pad: 'x'.repeat(40 * 1024 * 1024),
    });
    const r = await w.json<{ error: { code: string } }>('/api/staff/buildings', {
      method: 'POST',
      token,
      body: big,
    });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('payload_too_large');
  });

  it('JSON just over 1 MB is refused, under 1 MB is parsed', async () => {
    const token = await w.staffToken('admin@vamar.test');
    const over = await w.request('/api/staff/buildings', {
      method: 'POST',
      token,
      body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }),
    });
    expect(over.status).toBe(413);
    const under = await w.request('/api/staff/buildings', {
      method: 'POST',
      token,
      body: JSON.stringify({ pad: 'x'.repeat(1000) }),
    });
    expect(under.status).toBe(422);
  });

  it('uploads may be up to 11 MB of multipart, not more', async () => {
    const token = await w.staffToken('admin@vamar.test');
    const form = (bytes: number) => {
      const f = new FormData();
      f.set('entityType', 'dispute');
      f.set('entityId', crypto.randomUUID());
      f.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'x.png');
      return f;
    };
    const big = await w.request('/api/staff/attachments', {
      method: 'POST',
      token,
      body: form(12 * 1024 * 1024),
    });
    expect(big.status).toBe(413);
    const ok = await w.request('/api/staff/attachments', {
      method: 'POST',
      token,
      body: form(2 * 1024 * 1024),
    });
    // Within the body limit, so the route itself answers (the bytes are not a real image).
    expect(ok.status).toBe(422);
  });
});
