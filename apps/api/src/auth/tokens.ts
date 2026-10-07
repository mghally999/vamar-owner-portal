/**
 * Our own session tokens.
 * - Access token: HS256 JWT, 15 minutes, carries subject type/id, session id, role and mfa flag.
 * - Refresh token: random 256-bit secret, stored as SHA-256, rotated on every use, bound to the
 *   device for owners. Presenting an already-rotated token revokes the whole chain.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { schema } from '@vamar/db';
import type { Dbx } from '../db.js';
import { unauthorized } from '../errors.js';
import type { Bindings, Principal } from '../env.js';
import { randomToken, sha256 } from '../util/crypto.js';
import { log } from '../util/log.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const OWNER_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();

export async function signAccessToken(env: Bindings, principal: Principal): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    typ: principal.type,
    sid: principal.sessionId,
    ...(principal.type === 'staff' ? { role: principal.role, mfa: principal.mfa } : {}),
    ...(principal.type === 'owner' && principal.deviceId ? { did: principal.deviceId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SECONDS)
    .setIssuer('vamar-owner-portal');
  return jwt.sign(enc.encode(env.JWT_SECRET));
}

export async function verifyAccessToken(env: Bindings, token: string): Promise<Principal> {
  let payload: Record<string, unknown>;
  try {
    const res = await jwtVerify(token, enc.encode(env.JWT_SECRET), {
      issuer: 'vamar-owner-portal',
      algorithms: ['HS256'],
    });
    payload = res.payload;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const sub = payload['sub'];
  const sid = payload['sid'];
  const typ = payload['typ'];
  if (typeof sub !== 'string' || typeof sid !== 'string') throw unauthorized('Malformed token');
  if (typ === 'owner') {
    const did = payload['did'];
    return {
      type: 'owner',
      id: sub,
      sessionId: sid,
      deviceId: typeof did === 'string' ? did : null,
    };
  }
  if (typ === 'staff') {
    const role = payload['role'];
    if (role !== 'admin' && role !== 'editor' && role !== 'viewer')
      throw unauthorized('Malformed token');
    return { type: 'staff', id: sub, sessionId: sid, role, mfa: payload['mfa'] === true };
  }
  throw unauthorized('Malformed token');
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Create a brand-new session row and return the plaintext refresh token (shown once). */
export async function createSession(
  db: Dbx,
  input: {
    subjectType: 'owner' | 'staff';
    subjectId: string;
    deviceId: string | null;
    ttlMs: number;
    rotatedFrom?: string | null;
  },
): Promise<IssuedSession> {
  const refreshToken = randomToken(32);
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await db
    .insert(schema.sessions)
    .values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      deviceId: input.deviceId,
      tokenHash: await sha256(refreshToken),
      expiresAt,
      rotatedFrom: input.rotatedFrom ?? null,
    })
    .returning({ id: schema.sessions.id });
  if (!row) throw new Error('session insert returned nothing');
  return { sessionId: row.id, refreshToken, expiresAt };
}

export interface RotatedSession extends IssuedSession {
  subjectType: 'owner' | 'staff';
  subjectId: string;
  deviceId: string | null;
}

/**
 * Exchange a refresh token for a new one. The old session is revoked (rotation). If the token
 * was already rotated or revoked, someone replayed it: revoke the entire chain and refuse.
 */
export async function rotateSession(
  db: Dbx,
  refreshToken: string,
  expected: { subjectType: 'owner' | 'staff'; deviceId: string | null; ttlMs: number },
): Promise<RotatedSession> {
  const hash = await sha256(refreshToken);
  const current = await db.query.sessions.findFirst({
    where: eq(schema.sessions.tokenHash, hash),
  });
  if (current?.subjectType !== expected.subjectType) throw unauthorized('Unknown session');

  if (current.revokedAt) {
    // Replay of a rotated token: kill the whole chain for this subject + device.
    await revokeChain(db, current.subjectType, current.subjectId, current.deviceId);
    log('warn', 'auth.refresh_replay', {
      subjectType: current.subjectType,
      subjectId: current.subjectId,
    });
    throw unauthorized('Session revoked');
  }
  if (current.expiresAt.getTime() < Date.now()) throw unauthorized('Session expired');
  if (expected.subjectType === 'owner' && current.deviceId !== expected.deviceId) {
    throw unauthorized('Session is bound to another device');
  }

  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, current.id));
  const next = await createSession(db, {
    subjectType: current.subjectType,
    subjectId: current.subjectId,
    deviceId: current.deviceId,
    ttlMs: expected.ttlMs,
    rotatedFrom: current.id,
  });
  return {
    ...next,
    subjectType: current.subjectType,
    subjectId: current.subjectId,
    deviceId: current.deviceId,
  };
}

/**
 * Run BEFORE the rotation transaction, on an autocommit connection: if the presented token was
 * already rotated or revoked, revoke the whole chain (committed even though we then refuse).
 */
export async function rejectReplayedToken(db: Dbx, refreshToken: string): Promise<void> {
  const hash = await sha256(refreshToken);
  const current = await db.query.sessions.findFirst({ where: eq(schema.sessions.tokenHash, hash) });
  if (!current) throw unauthorized('Unknown session');
  if (current.revokedAt) {
    await revokeChain(db, current.subjectType, current.subjectId, current.deviceId);
    log('warn', 'auth.refresh_replay', {
      subjectType: current.subjectType,
      subjectId: current.subjectId,
    });
    throw unauthorized('Session revoked');
  }
}

export async function revokeSessionByToken(db: Dbx, refreshToken: string): Promise<void> {
  const hash = await sha256(refreshToken);
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.tokenHash, hash), isNull(schema.sessions.revokedAt)));
}

export async function revokeChain(
  db: Dbx,
  subjectType: 'owner' | 'staff',
  subjectId: string,
  deviceId: string | null,
): Promise<void> {
  const conditions = [
    eq(schema.sessions.subjectType, subjectType),
    eq(schema.sessions.subjectId, subjectId),
    isNull(schema.sessions.revokedAt),
  ];
  if (deviceId) conditions.push(eq(schema.sessions.deviceId, deviceId));
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions));
}

/** Is the session behind an access token still alive? Used on sensitive calls only. */
export async function isSessionActive(db: Dbx, sessionId: string): Promise<boolean> {
  const row = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
    columns: { revokedAt: true, expiresAt: true },
  });
  // A rotated session is "revoked" but its access token may still be valid for up to 15 minutes;
  // we only treat the chain as dead when the newest descendant is also revoked.
  if (!row) return false;
  if (!row.revokedAt) return row.expiresAt.getTime() > Date.now();
  const child = await db.query.sessions.findFirst({
    where: eq(schema.sessions.rotatedFrom, sessionId),
    columns: { id: true, revokedAt: true },
  });
  return child?.revokedAt === null;
}
