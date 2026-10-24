/**
 * Regression tests for the hardening pass: configuration validation, the production guard on the
 * Firebase emulator path, revocation of live access tokens, single-use TOTP codes, verified e-mail
 * on staff binding, the 2-step switch rules, cache headers, the readiness probe and the one
 * validation error envelope.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyFirebaseIdToken } from '../src/auth/firebase.js';
import { forgetSession } from '../src/auth/middleware.js';
import { currentTotpCode } from '../src/auth/totp.js';
import { cspConnectSrc, validateEnv } from '../src/config.js';
import { app } from '../src/app.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

describe('configuration', () => {
  it('accepts the test environment and refuses placeholders, emulator and localhost in production', () => {
    expect(validateEnv(w.env)).toEqual([]);
    const { TEST_DB: _db, ...rest } = w.env;
    const prod = {
      ...rest,
      APP_ENV: 'production' as const,
      DATABASE_URL: 'postgres://vamar:vamar@localhost:5433/vamar',
      JWT_SECRET: 'dev-only-change-me-dev-only-change-me-dev-only',
    };
    const problems = validateEnv(prod);
    expect(problems).toContain('a development placeholder secret is set');
    expect(problems).toContain('FIREBASE_AUTH_EMULATOR_HOST must not be set in production');
    expect(problems).toContain('DATABASE_URL points at localhost in production');
    expect(validateEnv({ ...w.env, JWT_SECRET: 'short' })).toContain(
      'JWT_SECRET must be at least 32 characters',
    );
    expect(validateEnv({ ...w.env, TOTP_ENC_KEY: 'c2hvcnQ=' })).toContain(
      'TOTP_ENC_KEY must encode at least 32 bytes',
    );
  });

  it('the Worker entry refuses to serve a misconfigured environment', async () => {
    const worker = (await import('../src/index.js')).default;
    const res = await worker.fetch!(
      new Request('http://test/healthz'),
      { ...w.env, JWT_SECRET: '' },
      w.ctx,
    );
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('internal');
  });

  it('never trusts unsigned Firebase tokens in production', async () => {
    const unsigned = await w.firebaseToken({ phone_number: '+971500000001' });
    await expect(
      verifyFirebaseIdToken({ ...w.env, APP_ENV: 'production' }, unsigned),
    ).rejects.toMatchObject({ status: 401 });
    expect(cspConnectSrc({ APP_ENV: 'production' })).not.toContain('http://localhost:9099');
    expect(cspConnectSrc({ APP_ENV: 'development' })).toContain('http://localhost:9099');
  });
});

describe('headers and probes', () => {
  it('API responses are never cacheable and the Worker sends a permissions policy', async () => {
    const r = await w.request('/api/owner/me');
    expect(r.status).toBe(401);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('pragma')).toBe('no-cache');
    expect(r.headers.get('permissions-policy')).toContain('camera=()');
    const prod = await app.request(
      'http://test/api/nothing',
      {},
      { ...w.env, APP_ENV: 'production' },
      w.ctx,
    );
    expect(prod.headers.get('content-security-policy')).not.toContain('localhost');
  });

  it('readiness probe answers from the database and liveness does not', async () => {
    const live = await w.json<{ ok: boolean; env: string }>('/healthz');
    expect(live.body).toEqual({ ok: true, env: 'test' });
    const ready = await w.json<{ ok: boolean; db: boolean }>('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ ok: true, db: true });
  });

  it('bad bodies, params and cursors use the one validation envelope', async () => {
    const owner = await w.ownerToken('+971500000001');
    const badParam = await w.json<{ error: { code: string } }>(
      '/api/auth/owner/devices/not-a-uuid/revoke',
      { method: 'POST', token: owner },
    );
    expect(badParam.status).toBe(422);
    expect(badParam.body.error.code).toBe('validation');
    const forged = Buffer.from(JSON.stringify(["1' or 1=1", 'x'])).toString('base64url');
    const badCursor = await w.json<{ error: { code: string } }>(
      `/api/owner/cheques?cursor=${forged}`,
      { token: owner },
    );
    expect(badCursor.status).toBe(422);
    expect(badCursor.body.error.code).toBe('validation');
  });
});

describe('sessions and 2-step login', () => {
  it('a revoked session stops its access token at once', async () => {
    const admin = await w.staffToken('admin@vamar.test');
    expect((await w.request('/api/auth/staff/me', { token: admin })).status).toBe(200);
    const out = await w.request('/api/auth/staff/logout-all', { method: 'POST', token: admin });
    expect(out.status).toBe(200);
    forgetSession();
    expect((await w.request('/api/auth/staff/me', { token: admin })).status).toBe(401);

    const owner = await w.ownerToken('+971500000002');
    expect((await w.request('/api/owner/me', { token: owner })).status).toBe(200);
    await w.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.subjectId, w.ids.owners['+971500000002']!));
    forgetSession();
    expect((await w.request('/api/owner/me', { token: owner })).status).toBe(401);
  });

  it('binding a Firebase account to a staff row needs a verified e-mail', async () => {
    const unverified = await w.firebaseToken({ email: 'viewer@vamar.test', email_verified: false });
    const r = await w.json<{ error: { code: string } }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: unverified }),
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('email_unverified');
    const verified = await w.firebaseToken({ email: 'viewer@vamar.test', email_verified: true });
    const ok = await w.json<{ preAuthToken: string }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: verified }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.preAuthToken).toBeTruthy();
  });

  it('a TOTP code is accepted once, and a pre-auth token completes one sign-in', async () => {
    const sub = `fb-${crypto.randomUUID()}`;
    const fb = await w.firebaseToken({ email: 'admin@vamar.test', email_verified: true, sub });
    const ex = await w.json<{ preAuthToken: string }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb }),
    });
    const setup = await w.json<{ secret: string }>('/api/auth/staff/totp/setup', {
      method: 'POST',
      token: ex.body.preAuthToken,
    });
    const code = currentTotpCode(setup.body.secret);
    const first = await w.request('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex.body.preAuthToken,
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);
    // The same code through a fresh pre-auth token: refused as a replay.
    const ex2 = await w.json<{ preAuthToken: string }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: fb }),
    });
    const again = await w.json<{ error: { code: string } }>('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex2.body.preAuthToken,
      body: JSON.stringify({ code }),
    });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('totp_invalid');
    // The used pre-auth token: refused before any code is looked at.
    const reused = await w.request('/api/auth/staff/totp/verify', {
      method: 'POST',
      token: ex.body.preAuthToken,
      body: JSON.stringify({ code }),
    });
    expect(reused.status).toBe(401);
    const setupAgain = await w.request('/api/auth/staff/totp/setup', {
      method: 'POST',
      token: ex.body.preAuthToken,
    });
    expect(setupAgain.status).toBe(401);
  });

  it('2-step login cannot be switched off for admins or for oneself, and is forced back on with the admin role', async () => {
    const admin = await w.staffToken('admin@vamar.test');
    const me = w.ids.staff['admin@vamar.test']!;
    const entry = w.ids.staff['entry@vamar.test']!;
    const self = await w.json<{ error: { code: string } }>(`/api/staff/staff/${me}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ totpRequired: false }),
    });
    expect(self.status).toBe(409);
    const asAdmin = await w.json<{ error: { code: string } }>(`/api/staff/staff/${entry}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ role: 'admin', totpRequired: false }),
    });
    expect(asAdmin.status).toBe(409);
    // Outside the demo trial even the listed demo editor keeps 2-step login.
    const noTrial = await w.json<{ error: { code: string } }>(`/api/staff/staff/${entry}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ totpRequired: false }),
    });
    expect(noTrial.status).toBe(409);
    w.env.DEMO_TRIAL = 'true';
    const off = await w.json<{ totpRequired: boolean }>(`/api/staff/staff/${entry}`, {
      method: 'PATCH',
      token: admin,
      body: JSON.stringify({ totpRequired: false }),
    });
    delete w.env.DEMO_TRIAL;
    expect(off.status).toBe(200);
    expect(off.body.totpRequired).toBe(false);
    const promoted = await w.json<{ totpRequired: boolean; role: string }>(
      `/api/staff/staff/${entry}`,
      { method: 'PATCH', token: admin, body: JSON.stringify({ role: 'admin' }) },
    );
    expect(promoted.body.role).toBe('admin');
    expect(promoted.body.totpRequired).toBe(true);
    await w.db
      .update(schema.staffUsers)
      .set({ role: 'editor', totpRequired: true })
      .where(eq(schema.staffUsers.id, entry));
  });
});
