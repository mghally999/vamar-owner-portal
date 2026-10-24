import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { schema } from '@vamar/db';
import { staffExchangeSchema, totpCodeSchema } from '@vamar/shared';
import { verifyFirebaseIdToken } from '../auth/firebase.js';
import { isDeployed, maySkipTotp } from '../config.js';
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
import { zValidator } from '../util/validator.js';

const { staffUsers } = schema;
const COOKIE = 'vamar_staff_refresh';
const LOCK_MINUTES = Math.round(TOTP_LOCK_MS / 60_000);

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
    setRefreshCookie(c, session.refreshToken, session.expiresAt);
    log('info', 'auth.staff_login', { staffId: user.id, ip });
    return c.json({
      accessToken,
      accessExpiresIn: ACCESS_TTL_SECONDS,
      sessionExpiresAt: session.expiresAt.toISOString(),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });
}

/**
 * A pre-auth token is good for one authenticator step: once it has produced a session (whose id
 * is the token's `sid`), it is refused, so it cannot mint further sessions with later codes.
 */
async function rejectUsedPreAuth(c: Context<AppEnv>, p: StaffPrincipal): Promise<void> {
  const used = await readDb(c).query.sessions.findFirst({
    where: eq(schema.sessions.id, p.sessionId),
    columns: { id: true },
  });
  if (used) throw unauthorized('This sign-in step is already complete; sign in again');
}

/** Always Secure: the Worker only ever answers over HTTPS and browsers treat localhost as secure. */
function setRefreshCookie(c: Parameters<typeof setCookie>[0], token: string, expires: Date) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
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
        // First login after an invite binds the Firebase account to the staff row. The e-mail must
        // be verified by Firebase first, otherwise anyone who can create a Firebase account with
        // this address would become this staff member. Seeded placeholder uids bind only outside
        // production (local emulator).
        const pending =
          user.firebaseUid.startsWith('invite:') ||
          (!isDeployed(c.env) && user.firebaseUid.startsWith('seed-'));
        if (pending) {
          if (!identity.emailVerified) {
            log('warn', 'auth.staff_email_unverified', { staffId: user.id, ip });
            throw new ApiError(
              403,
              'email_unverified',
              'Verify your e-mail address with the link Firebase sent you, then sign in again',
            );
          }
          log('info', 'auth.staff_uid_bound', { staffId: user.id, ip });
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
    if (maySkipTotp(c.env, staff)) {
      // Listed demo account, 2-step login off, DEMO_TRIAL on: the client trial only. Every other
      // account goes through the authenticator, whatever its row says.
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
    await rejectUsedPreAuth(c, p);
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
      await rejectUsedPreAuth(c, p);
      // Everything before the success path runs on an autocommit connection so failures persist.
      const plain = readDb(c);
      await enforceRateLimit(plain, RATE_LIMITS.totpIp, ip);
      await enforceRateLimit(plain, RATE_LIMITS.totpUser, p.id);
      const user = await plain.query.staffUsers.findFirst({ where: eq(staffUsers.id, p.id) });
      if (!user?.active) throw unauthorized();
      if (!user.totpSecretEnc)
        throw new ApiError(409, 'conflict', 'Set up the authenticator first');
      if (user.totpLockedUntil && user.totpLockedUntil.getTime() > Date.now()) {
        throw new ApiError(
          429,
          'totp_locked',
          `Too many wrong codes; try again in ${LOCK_MINUTES} minutes`,
          {
            lockedUntil: user.totpLockedUntil.toISOString(),
          },
        );
      }
      const verdict = await verifyTotpCode(user.totpSecretEnc, code, c.env.TOTP_ENC_KEY);
      // A code is accepted once: replaying the step that signed in last time counts as a wrong code.
      const replay = verdict.ok && user.totpLastStep !== null && verdict.step <= user.totpLastStep;
      if (!verdict.ok || replay) {
        const failures = user.totpFailures + 1;
        const lock = failures >= TOTP_MAX_FAILURES;
        await plain
          .update(staffUsers)
          .set({
            totpFailures: lock ? 0 : failures,
            totpLockedUntil: lock ? new Date(Date.now() + TOTP_LOCK_MS) : null,
          })
          .where(eq(staffUsers.id, p.id));
        log('warn', 'auth.totp_failed', { staffId: p.id, failures, locked: lock, replay, ip });
        throw new ApiError(
          lock ? 429 : 403,
          lock ? 'totp_locked' : 'totp_invalid',
          lock ? `Too many wrong codes; locked for ${LOCK_MINUTES} minutes` : 'Wrong code',
        );
      }
      const { session } = await withTx(c, async (tx) => {
        const firstEnrollment = !user.totpEnabled;
        await tx
          .update(staffUsers)
          .set({
            totpEnabled: true,
            totpFailures: 0,
            totpLockedUntil: null,
            totpLastStep: verdict.step,
          })
          .where(eq(staffUsers.id, p.id));
        if (firstEnrollment) {
          await audit(tx, actorFromContext(c, { ...p, mfa: true }), {
            action: 'staff.totp_enrolled',
            entityType: 'staff_user',
            entityId: p.id,
          });
        }
        // The pre-auth token's id becomes the session id, so that token completes this step once.
        const session = await createSession(tx, {
          id: p.sessionId,
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
    setRefreshCookie(c, rotated.refreshToken, rotated.expiresAt);
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
    const user = await readDb(c).query.staffUsers.findFirst({
      where: eq(staffUsers.id, p.id),
      columns: { id: true, name: true, email: true, role: true, totpEnabled: true },
    });
    if (!user) throw unauthorized();
    return c.json(user);
  })

  .post('/logout-all', requireStaff('viewer'), async (c) => {
    const p = staffOf(c);
    await withTx(c, (tx) => revokeChain(tx, 'staff', p.id, null));
    deleteCookie(c, COOKIE, { path: '/api/auth/staff' });
    return c.json({ ok: true });
  });
