import { createMiddleware } from 'hono/factory';
import type { StaffRole } from '@vamar/shared';
import type { Context } from 'hono';
import { readDb } from '../db.js';
import type { AppEnv, OwnerPrincipal, StaffPrincipal } from '../env.js';
import { ApiError, forbidden, unauthorized } from '../errors.js';
import { forgetSession, isCachedActive, rememberActive } from './session-cache.js';
import { isSessionActive, verifyAccessToken } from './tokens.js';

export { forgetSession, SESSION_CHECK_CACHE_MS } from './session-cache.js';

function bearer(authorization: string | undefined): string {
  if (!authorization?.startsWith('Bearer ')) throw unauthorized();
  return authorization.slice(7).trim();
}

/**
 * Revocation check. The access token is short-lived, but "sign out other devices", "disable
 * owner" and "deactivate staff" must bite before it expires, so the session row is consulted. A
 * positive answer is remembered per isolate for a short time to keep one database round trip off
 * most requests (session-cache.ts). A revocation clears the entries it revoked in this isolate at
 * once; other isolates see it within SESSION_CHECK_CACHE_MS at the latest.
 */
async function ensureSessionActive(c: Context<AppEnv>, sessionId: string): Promise<void> {
  if (isCachedActive(sessionId)) return;
  const ok = await isSessionActive(readDb(c), sessionId);
  if (!ok) {
    forgetSession(sessionId);
    throw unauthorized('Session ended');
  }
  rememberActive(sessionId);
}

/** Owner endpoints: the owner id comes from the token only, never from params or body. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await verifyAccessToken(c.env, bearer(c.req.header('authorization')));
  if (principal.type !== 'owner') throw forbidden('Owner access only');
  await ensureSessionActive(c, principal.sessionId);
  c.set('principal', principal);
  await next();
});

const ROLE_RANK: Record<StaffRole, number> = { viewer: 0, editor: 1, admin: 2 };

/**
 * Staff endpoints. `minRole` is enforced here, not only in the UI. Tokens issued before the TOTP
 * step carry `mfa: false` and are refused unless `allowPreMfa` is set (TOTP endpoints only); they
 * have no session row yet, so the revocation check applies to full sessions only.
 */
export function requireStaff(
  minRole: StaffRole = 'viewer',
  options: { allowPreMfa?: boolean } = {},
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const principal = await verifyAccessToken(c.env, bearer(c.req.header('authorization')));
    if (principal.type !== 'staff') throw forbidden('Staff access only');
    if (!principal.mfa && !options.allowPreMfa) {
      throw new ApiError(403, 'totp_required', 'Complete the authenticator step first');
    }
    if (ROLE_RANK[principal.role] < ROLE_RANK[minRole]) throw forbidden(`Requires ${minRole} role`);
    if (principal.mfa) await ensureSessionActive(c, principal.sessionId);
    c.set('principal', principal);
    await next();
  });
}

/** The signed-in owner (routes behind requireOwner). */
export function ownerOf(c: Context<AppEnv>): OwnerPrincipal {
  const p = c.get('principal');
  if (p.type !== 'owner') throw forbidden('Owner access only');
  return p;
}

/** The signed-in staff member (routes behind requireStaff). */
export function staffOf(c: Context<AppEnv>): StaffPrincipal {
  const p = c.get('principal');
  if (p.type !== 'staff') throw forbidden('Staff access only');
  return p;
}
