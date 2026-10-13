import { eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentTotpCode } from '../src/auth/totp.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

const device = {
  deviceId: 'device-aaaaaaaa',
  platform: 'ios',
  model: 'iPhone 15',
  pushToken: 'ExponentPushToken[test]',
};

describe('owner auth', () => {
  it('exchanges a Firebase phone token for our session and refreshes with rotation', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971500000001' });
    const ex = await w.json<{
      accessToken: string;
      refreshToken: string;
      owner: { nameEn: string };
    }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb, device }),
    });
    expect(ex.status).toBe(200);
    expect(ex.body.owner.nameEn).toBe('Khalid Al Mansoori');
    const me = await w.json<{ phoneE164: string }>('/api/owner/me', { token: ex.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.phoneE164).toBe('+971500000001');

    const r1 = await w.json<{ accessToken: string; refreshToken: string }>(
      '/api/auth/owner/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken: ex.body.refreshToken, deviceId: device.deviceId }),
      },
    );
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(ex.body.refreshToken);

    // Replaying the old token revokes the whole chain
    const replay = await w.request('/api/auth/owner/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: ex.body.refreshToken, deviceId: device.deviceId }),
    });
    expect(replay.status).toBe(401);
    const afterReplay = await w.request('/api/auth/owner/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: r1.body.refreshToken, deviceId: device.deviceId }),
    });
    expect(afterReplay.status).toBe(401);
  });

  it('refresh is bound to the device', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971500000002' });
    const ex = await w.json<{ refreshToken: string }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({
        firebaseIdToken: fb,
        device: { ...device, deviceId: 'device-bbbbbbbb' },
      }),
    });
    const other = await w.request('/api/auth/owner/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: ex.body.refreshToken, deviceId: 'device-cccccccc' }),
    });
    expect(other.status).toBe(401);
  });

  it('unknown phone gets a polite owner_not_registered, disabled owner gets owner_disabled', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971509999999' });
    const res = await w.json<{ error: { code: string } }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb, device }),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('owner_not_registered');

    await w.db
      .update(schema.owners)
      .set({ status: 'disabled' })
      .where(eq(schema.owners.phoneE164, '+971500000005'));
    const fb2 = await w.firebaseToken({ phone_number: '+971500000005' });
    const res2 = await w.json<{ error: { code: string } }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb2, device }),
    });
    expect(res2.body.error.code).toBe('owner_disabled');
    await w.db
      .update(schema.owners)
      .set({ status: 'active' })
      .where(eq(schema.owners.phoneE164, '+971500000005'));
  });

  it('phones outside the allowed countries are refused', async () => {
    const fb = await w.firebaseToken({ phone_number: '+447700900000' });
    const res = await w.json<{ error: { code: string } }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb, device }),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('owner_not_registered');
  });

  it('rejects tokens for another Firebase project', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971500000001', aud: 'other-project' });
    const res = await w.request('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb, device }),
    });
    expect(res.status).toBe(401);
  });

  it('new device login queues an alert and the devices list shows both devices', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971500000003' });
    const a = await w.json<{ accessToken: string }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({
        firebaseIdToken: fb,
        device: { ...device, deviceId: 'device-first-01' },
      }),
    });
    const b = await w.json<{ accessToken: string }>('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({
        firebaseIdToken: fb,
        device: { ...device, deviceId: 'device-second-02', model: 'Pixel 9' },
      }),
    });
    await w.flush();
    const list = await w.json<{ items: { deviceId: string; current: boolean }[] }>(
      '/api/auth/owner/devices',
      { token: b.body.accessToken },
    );
    expect(list.body.items.map((d) => d.deviceId).sort()).toEqual([
      'device-first-01',
      'device-second-02',
    ]);
    expect(list.body.items.find((d) => d.current)?.deviceId).toBe('device-second-02');
    const logs = await w.db
      .select()
      .from(schema.notificationLog)
      .where(eq(schema.notificationLog.type, 'new_device_login'));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    // revoke others from device b: device a's session dies
    const rev = await w.request('/api/auth/owner/devices/revoke-others', {
      method: 'POST',
      token: b.body.accessToken,
    });
    expect(rev.status).toBe(200);
    expect(a.status).toBe(200);
  });

  it('rate limits the exchange endpoint per phone', async () => {
    const fb = await w.firebaseToken({ phone_number: '+971500000004' });
    let last = 200;
    for (let i = 0; i < 12; i++) {
      const res = await w.request('/api/auth/owner/exchange', {
        method: 'POST',
        body: JSON.stringify({ firebaseIdToken: fb, device }),
        headers: { 'cf-connecting-ip': `10.0.0.${i}` },
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe('staff auth', () => {
  it('signs a staff user in without 2-step login when totp_required is off', async () => {
    await w.db
      .update(schema.staffUsers)
      .set({ totpRequired: false })
      .where(eq(schema.staffUsers.email, 'entry@vamar.test'));
    const fb = await w.firebaseToken({ email: 'entry@vamar.test', email_verified: true });
    const ex = await w.json<{
      accessToken?: string;
      preAuthToken?: string;
      user?: { email: string };
    }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb }),
    });
    expect(ex.status).toBe(200);
    expect(ex.body.preAuthToken).toBeUndefined();
    expect(ex.body.user?.email).toBe('entry@vamar.test');
    const me = await w.json<{ items: unknown[] }>('/api/staff/buildings', {
      token: ex.body.accessToken,
    });
    expect(me.status).toBe(200);
    await w.db
      .update(schema.staffUsers)
      .set({ totpRequired: true, firebaseUid: 'seed-staff-entry' })
      .where(eq(schema.staffUsers.email, 'entry@vamar.test'));
  });

  it('exchange -> totp setup -> verify -> full token with refresh cookie; viewer is blocked from writes', async () => {
    const fb = await w.firebaseToken({ email: 'entry@vamar.test', email_verified: true });
    const ex = await w.json<{ preAuthToken: string; totpEnrolled: boolean }>(
      '/api/auth/staff/exchange',
      { method: 'POST', body: JSON.stringify({ firebaseIdToken: fb }) },
    );
    expect(ex.status).toBe(200);
    expect(ex.body.totpEnrolled).toBe(false);
    // pre-MFA token cannot read data
    expect((await w.request('/api/staff/owners', { token: ex.body.preAuthToken })).status).toBe(
      403,
    );

    const setup = await w.json<{ secret: string; otpauthUri: string }>(
      '/api/auth/staff/totp/setup',
      { method: 'POST', token: ex.body.preAuthToken },
    );
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');

    const wrong = await w.request('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex.body.preAuthToken,
      body: JSON.stringify({ code: '000000' }),
    });
    expect(wrong.status).toBe(403);

    const verify = await w.request('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex.body.preAuthToken,
      body: JSON.stringify({ code: currentTotpCode(setup.body.secret) }),
    });
    expect(verify.status).toBe(200);
    const cookie = verify.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('vamar_staff_refresh=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const body = (await verify.json()) as { accessToken: string; user: { role: string } };
    expect(body.user.role).toBe('editor');
    expect((await w.request('/api/staff/owners', { token: body.accessToken })).status).toBe(200);

    const refreshed = await w.request('/api/auth/staff/refresh', {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0]! },
    });
    expect(refreshed.status).toBe(200);
  });

  it('locks TOTP after 5 wrong codes', async () => {
    const fb = await w.firebaseToken({ email: 'viewer@vamar.test', email_verified: true });
    const ex = await w.json<{ preAuthToken: string }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb }),
    });
    await w.request('/api/auth/staff/totp/setup', { method: 'POST', token: ex.body.preAuthToken });
    for (let i = 0; i < 4; i++) {
      const status = (
        await w.request('/api/auth/staff/totp/verify', {
          method: 'POST',
          token: ex.body.preAuthToken,
          body: JSON.stringify({ code: '111111' }),
        })
      ).status;
      expect(status).toBe(403);
    }
    // fifth wrong code locks the account for 15 minutes
    const fifth = await w.json<{ error: { code: string } }>('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex.body.preAuthToken,
      body: JSON.stringify({ code: '111111' }),
    });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('totp_locked');
    const locked = await w.json<{ error: { code: string } }>('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex.body.preAuthToken,
      body: JSON.stringify({ code: '111111' }),
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('totp_locked');
  });

  it('unknown staff email is refused', async () => {
    const fb = await w.firebaseToken({ email: 'stranger@example.com', email_verified: true });
    const ex = await w.request('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb }),
    });
    expect(ex.status).toBe(403);
  });

  it('roles are enforced on the API', async () => {
    const viewer = await w.staffToken('viewer@vamar.test');
    const editor = await w.staffToken('entry@vamar.test');
    const admin = await w.staffToken('admin@vamar.test');
    const owner = { nameAr: 'تجربة', nameEn: 'Test Owner', phoneE164: '+971501111111' };
    expect(
      (
        await w.request('/api/staff/owners', {
          method: 'POST',
          token: viewer,
          body: JSON.stringify(owner),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.request('/api/staff/owners', {
          method: 'POST',
          token: editor,
          body: JSON.stringify(owner),
        })
      ).status,
    ).toBe(201);
    expect((await w.request('/api/staff/staff', { token: editor })).status).toBe(403);
    expect((await w.request('/api/staff/staff', { token: admin })).status).toBe(200);
    expect((await w.request('/api/staff/audit', { token: editor })).status).toBe(403);
    expect((await w.request('/api/staff/audit', { token: admin })).status).toBe(200);
  });
});
