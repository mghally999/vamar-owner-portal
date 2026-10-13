import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { schema } from '@vamar/db';
import { staffExchangeSchema, totpCodeSchema } from '@vamar/shared';
import { verifyFirebaseIdToken } from '../auth/firebase.js';
import { requireStaff, staffOf } from '../auth/middleware.js';
import { clientIp, enforceRateLimit, RATE_LIMITS } from '../auth/ratelimit.js';
import {
  ACCESS_TTL_SECONDS,
  createSession,
  rejectReplayedToken,
  revokeChain,
  revokeSessionByToken,
  rotateSession,
  signAccessToken,
  STAFF_SESSION_TTL_MS,
} from '../auth/tokens.js';
import {
  createTotpEnrollment,
  TOTP_LOCK_MS,
  TOTP_MAX_FAILURES,
  verifyTotpCode,
} from '../auth/totp.js';
import { readDb, withTx } from '../db.js';
import type { AppEnv, StaffPrincipal } from '../env.js';
import { ApiError, unauthorized } from '../errors.js';
import { audit, actorFromContext } from '../services/audit.js';
import { sha256 } from '../util/crypto.js';
import { log, maskEmail } from '../util/log.js';

const { staffUsers } = schema;
const COOKIE = 'vamar_staff_refresh';

/** Full session for a verified staff user: access token in the body, refresh token in the cookie. */
function issueStaffSession(
  c: Context<AppEnv>,
  user: { id: string; name: string; email: string; role: StaffPrincipal['role'] },
  session: Awaited<ReturnType<typeof createSession>>,
  ip: string,
) {
  const principal: StaffPrincipal = {
    type: 'staff',
    id: user.id,
    sessionId: session.sessionId,
    role: user.role,
    mfa: true,
  };
  return signAccessToken(c.env, principal).then((accessToken) => {
    setRefreshCookie(c, session.refreshToken, session.expiresAt, c.env.APP_ENV === 'production');
    log('info', 'auth.staff_login', { staffId: user.id, ip });
    return c.json({
      accessToken,
      accessExpiresIn: ACCESS_TTL_SECONDS,
      sessionExpiresAt: session.expiresAt.toISOString(),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });
}

function setRefreshCookie(
  c: Parameters<typeof setCookie>[0],
  token: string,
  expires: Date,
  secure: boolean,
) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/api/auth/staff',
    expires,
  });
}

export const authStaffRoutes = new Hono<AppEnv>()
  /**
   * Step 1: Firebase email/password ID token -> short pre-MFA access token (mfa: false).
   * The staff user must exist (invite only) and be active.
   */
  .post('/exchange', zValidator('json', staffExchangeSchema), async (c) => {
    const { firebaseIdToken } = c.req.valid('json');
    const ip = clientIp(c.req.raw.headers);
    await enforceRateLimit(readDb(c), RATE_LIMITS.staffExchangeIp, ip);
    const identity = await verifyFirebaseIdToken(c.env, firebaseIdToken);
    const email = identity.email?.toLowerCase();
    if (!email) throw unauthorized('Email sign-in required');
    await enforceRateLimit(readDb(c), RATE_LIMITS.staffExchangeEmail, email);
    const staff = await withTx(c, async (tx) => {
      const user = await tx.query.staffUsers.findFirst({ where: eq(staffUsers.email, email) });
      if (!user?.active) {
        log('warn', 'auth.staff_unknown', { email: maskEmail(email), ip });
        throw new ApiError(403, 'forbidden', 'This email is not a Vamar staff account');
      }
      if (user.firebaseUid !== identity.uid) {
        // First login after invite (seed/placeholder uid) binds the Firebase account.
        if (user.firebaseUid.startsWith('invite:') || user.firebaseUid.startsWith('seed-')) {
          await tx
            .update(staffUsers)
            .set({ firebaseUid: identity.uid })
            .where(eq(staffUsers.id, user.id));
        } else {
          throw unauthorized('Firebase account does not match this staff user');
        }
      }
      return user;
    });
    if (!staff.totpRequired) {
      // 2-step login switched off for this account (demo accounts during a client trial only).
      const session = await withTx(c, (tx) =>
        createSession(tx, {
          subjectType: 'staff',
          subjectId: staff.id,
          deviceId: null,
          ttlMs: STAFF_SESSION_TTL_MS,
        }),
      );
      return issueStaffSession(c, staff, session, ip);
    }
    const principal: StaffPrincipal = {
      type: 'staff',
      id: staff.id,
      sessionId: crypto.randomUUID(),
      role: staff.role,
      mfa: false,
    };
    const preToken = await signAccessToken(c.env, principal);
    return c.json({
      preAuthToken: preToken,
      totpEnrolled: staff.totpEnabled,
      name: staff.name,
      role: staff.role,
    });
  })

  /** Step 2a: first time only, start TOTP enrollment (QR + manual secret). */
  .post('/totp/setup', requireStaff('viewer', { allowPreMfa: true }), async (c) => {
    const p = staffOf(c);
    const enrollment = await withTx(c, async (tx) => {
      const user = await tx.query.staffUsers.findFirst({ where: eq(staffUsers.id, p.id) });
      if (!user) throw unauthorized();
      if (user.totpEnabled)
        throw new ApiError(
          409,
          'conflict',
          'Authenticator already set up; ask an admin to reset it',
        );
      const e = await createTotpEnrollment(user.email, c.env.TOTP_ENC_KEY);
      await tx
        .update(staffUsers)
        .set({ totpSecretEnc: e.secretEnc, totpEnabled: false })
        .where(eq(staffUsers.id, p.id));
      return e;
    });
    return c.json({ otpauthUri: enrollment.uri, secret: enrollment.secretBase32 });
  })

  /** Step 2b: verify a code. On success: full access token + refresh cookie (12 h max session). */
  .post(
    '/totp/verify',
    requireStaff('viewer', { allowPreMfa: true }),
    zValidator('json', totpCodeSchema),
    async (c) => {
      const p = staffOf(c);
      const { code } = c.req.valid('json');
      const ip = clientIp(c.req.raw.headers);
      // Everything before the success path runs on an autocommit connection so failures persist.
      const plain = readDb(c);
      await enforceRateLimit(plain, RATE_LIMITS.totpIp, ip);
      await enforceRateLimit(plain, RATE_LIMITS.totpUser, p.id);
      const user = await plain.query.staffUsers.findFirst({ where: eq(staffUsers.id, p.id) });
      if (!user?.active) throw unauthorized();
      if (!user.totpSecretEnc)
        throw new ApiError(409, 'conflict', 'Set up the authenticator first');
      if (user.totpLockedUntil && user.totpLockedUntil.getTime() > Date.now()) {
        throw new ApiError(429, 'totp_locked', 'Too many wrong codes; try again in 15 minutes', {
          lockedUntil: user.totpLockedUntil.toISOString(),
        });
      }
      const ok = await verifyTotpCode(user.totpSecretEnc, code, c.env.TOTP_ENC_KEY);
      if (!ok) {
        const failures = user.totpFailures + 1;
        const lock = failures >= TOTP_MAX_FAILURES;
        await plain
          .update(staffUsers)
          .set({
            totpFailures: lock ? 0 : failures,
            totpLockedUntil: lock ? new Date(Date.now() + TOTP_LOCK_MS) : null,
          })
          .where(eq(staffUsers.id, p.id));
        log('warn', 'auth.totp_failed', { staffId: p.id, failures, locked: lock, ip });
        throw new ApiError(
          lock ? 429 : 403,
          lock ? 'totp_locked' : 'totp_invalid',
          lock ? 'Too many wrong codes; locked for 15 minutes' : 'Wrong code',
        );
      }
      const { session } = await withTx(c, async (tx) => {
        const firstEnrollment = !user.totpEnabled;
        await tx
          .update(staffUsers)
          .set({ totpEnabled: true, totpFailures: 0, totpLockedUntil: null })
          .where(eq(staffUsers.id, p.id));
        if (firstEnrollment) {
          await audit(tx, actorFromContext(c, { ...p, mfa: true }), {
            action: 'staff.totp_enrolled',
            entityType: 'staff_user',
            entityId: p.id,
          });
        }
        const session = await createSession(tx, {
          subjectType: 'staff',
          subjectId: user.id,
          deviceId: null,
          ttlMs: STAFF_SESSION_TTL_MS,
        });
        return { session };
      });
      return issueStaffSession(c, user, session, ip);
    },
  )

  /** Refresh from the httpOnly cookie. The 12 h cap is enforced by not extending past the original session expiry. */
  .post('/refresh', async (c) => {
    const token = getCookie(c, COOKIE);
    if (!token) throw unauthorized('No session');
    const ip = clientIp(c.req.raw.headers);
    await enforceRateLimit(readDb(c), RATE_LIMITS.refreshIp, ip);
    await rejectReplayedToken(readDb(c), token);
    const { rotated, user } = await withTx(c, async (tx) => {
      const current = await tx.query.sessions.findFirst({
        where: eq(schema.sessions.tokenHash, await sha256(token)),
        columns: { createdAt: true, expiresAt: true, rotatedFrom: true },
      });
      const rotated = await rotateSession(tx, token, {
        subjectType: 'staff',
        deviceId: null,
        ttlMs: STAFF_SESSION_TTL_MS,
      });
      // Cap the chain at the original 12 h window.
      if (current) {
        const capped = new Date(Math.min(rotated.expiresAt.getTime(), current.expiresAt.getTime()));
        await tx
          .update(schema.sessions)
          .set({ expiresAt: capped })
          .where(eq(schema.sessions.id, rotated.sessionId));
        rotated.expiresAt = capped;
      }
      const user = await tx.query.staffUsers.findFirst({
        where: eq(staffUsers.id, rotated.subjectId),
      });
      if (!user?.active) throw unauthorized();
      return { rotated, user };
    });
    const accessToken = await signAccessToken(c.env, {
      type: 'staff',
      id: user.id,
      sessionId: rotated.sessionId,
      role: user.role,
      mfa: true,
    });
    setRefreshCookie(c, rotated.refreshToken, rotated.expiresAt, c.env.APP_ENV === 'production');
    return c.json({
      accessToken,
      accessExpiresIn: ACCESS_TTL_SECONDS,
      sessionExpiresAt: rotated.expiresAt.toISOString(),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })

  .post('/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await withTx(c, (tx) => revokeSessionByToken(tx, token));
    deleteCookie(c, COOKIE, { path: '/api/auth/staff' });
    return c.json({ ok: true });
  })

  .get('/me', requireStaff('viewer'), async (c) => {
    const p = staffOf(c);
    const user = await withTx(c, (tx) =>
      tx.query.staffUsers.findFirst({
        where: eq(staffUsers.id, p.id),
        columns: { id: true, name: true, email: true, role: true, totpEnabled: true },
      }),
    );
    if (!user) throw unauthorized();
    return c.json(user);
  })

  .post('/logout-all', requireStaff('viewer'), async (c) => {
    const p = staffOf(c);
    await withTx(c, (tx) => revokeChain(tx, 'staff', p.id, null));
    deleteCookie(c, COOKIE, { path: '/api/auth/staff' });
    return c.json({ ok: true });
  });
