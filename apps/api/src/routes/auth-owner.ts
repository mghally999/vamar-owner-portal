import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { schema } from '@vamar/db';
import { ownerExchangeSchema, refreshSchema, uuidSchema } from '@vamar/shared';
import { verifyFirebaseIdToken } from '../auth/firebase.js';
import { ownerOf, requireOwner } from '../auth/middleware.js';
import { clientIp, enforceRateLimit, RATE_LIMITS } from '../auth/ratelimit.js';
import {
  ACCESS_TTL_SECONDS,
  createSession,
  OWNER_REFRESH_TTL_MS,
  rejectReplayedToken,
  revokeChain,
  revokeSessionByToken,
  rotateSession,
  signAccessToken,
} from '../auth/tokens.js';
import { readDb, withTx } from '../db.js';
import type { AppEnv } from '../env.js';
import { ApiError, unauthorized } from '../errors.js';
import { queueNewDeviceAlert } from '../services/notifications.js';
import { log, maskPhone } from '../util/log.js';
import { zValidator } from '../util/validator.js';

const { owners, devices } = schema;

/** Country calling codes we accept for owner phones; configurable via ALLOWED_PHONE_COUNTRIES. */
const COUNTRY_PREFIX: Record<string, string> = {
  AE: '+971',
  SA: '+966',
  QA: '+974',
  KW: '+965',
  BH: '+973',
  OM: '+968',
  EG: '+20',
  GB: '+44',
  US: '+1',
  IN: '+91',
  PK: '+92',
};

export function phoneAllowed(phone: string, allowedCountries: string): boolean {
  const list = allowedCountries
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (list.includes('*')) return true;
  return list.some((cc) => {
    const prefix = COUNTRY_PREFIX[cc];
    return prefix ? phone.startsWith(prefix) : false;
  });
}

export const authOwnerRoutes = new Hono<AppEnv>()
  /**
   * App completed Firebase phone verification. Exchange the Firebase ID token for our session.
   * Unknown phone => polite "contact Vamar" (owner_not_registered). Disabled => owner_disabled.
   */
  .post('/exchange', zValidator('json', ownerExchangeSchema), async (c) => {
    const body = c.req.valid('json');
    const ip = clientIp(c.req.raw.headers);
    // Rate limits run on an autocommit connection so a refused attempt still counts.
    await enforceRateLimit(readDb(c), RATE_LIMITS.ownerExchangeIp, ip);
    const identity = await verifyFirebaseIdToken(c.env, body.firebaseIdToken);
    const phone = identity.phone;
    if (!phone) throw unauthorized('Phone sign-in required');
    await enforceRateLimit(readDb(c), RATE_LIMITS.ownerExchangePhone, phone);
    const result = await withTx(c, async (tx) => {
      if (!phoneAllowed(phone, c.env.ALLOWED_PHONE_COUNTRIES)) {
        throw new ApiError(
          403,
          'owner_not_registered',
          'This phone number is not registered with Vamar',
        );
      }
      const owner = await tx.query.owners.findFirst({ where: eq(owners.phoneE164, phone) });
      if (!owner) {
        log('info', 'auth.owner_not_registered', { phone: maskPhone(phone), ip });
        throw new ApiError(
          403,
          'owner_not_registered',
          'This phone number is not registered with Vamar',
        );
      }
      if (owner.status === 'disabled')
        throw new ApiError(403, 'owner_disabled', 'This account is disabled');
      if (owner.status === 'invited')
        await tx.update(owners).set({ status: 'active' }).where(eq(owners.id, owner.id));

      // Device registry: first sight of this device triggers a login alert to the other devices.
      const existingDevice = await tx.query.devices.findFirst({
        where: and(eq(devices.ownerId, owner.id), eq(devices.deviceId, body.device.deviceId)),
      });
      const now = new Date();
      let isNewDevice: boolean;
      if (existingDevice) {
        await tx
          .update(devices)
          .set({
            lastSeen: now,
            revokedAt: null,
            platform: body.device.platform,
            model: body.device.model,
            pushToken: body.device.pushToken ?? existingDevice.pushToken,
          })
          .where(eq(devices.id, existingDevice.id));
        isNewDevice = existingDevice.revokedAt !== null;
      } else {
        await tx.insert(devices).values({
          ownerId: owner.id,
          deviceId: body.device.deviceId,
          platform: body.device.platform,
          model: body.device.model,
          pushToken: body.device.pushToken,
          firstSeen: now,
          lastSeen: now,
        });
        isNewDevice = true;
      }
      // Only one live session per device.
      await revokeChain(tx, 'owner', owner.id, body.device.deviceId);
      const session = await createSession(tx, {
        subjectType: 'owner',
        subjectId: owner.id,
        deviceId: body.device.deviceId,
        ttlMs: OWNER_REFRESH_TTL_MS,
      });
      return { owner, session, isNewDevice };
    });

    const accessToken = await signAccessToken(c.env, {
      type: 'owner',
      id: result.owner.id,
      sessionId: result.session.sessionId,
      deviceId: body.device.deviceId,
    });
    if (result.isNewDevice) {
      c.executionCtx.waitUntil(queueNewDeviceAlert(c.env, result.owner.id, body.device));
    }
    log('info', 'auth.owner_exchange', {
      ownerId: result.owner.id,
      ip,
      newDevice: result.isNewDevice,
    });
    return c.json({
      accessToken,
      accessExpiresIn: ACCESS_TTL_SECONDS,
      refreshToken: result.session.refreshToken,
      refreshExpiresAt: result.session.expiresAt.toISOString(),
      owner: {
        id: result.owner.id,
        nameAr: result.owner.nameAr,
        nameEn: result.owner.nameEn,
        preferredLang: result.owner.preferredLang,
      },
    });
  })

  .post('/refresh', zValidator('json', refreshSchema), async (c) => {
    const body = c.req.valid('json');
    const ip = clientIp(c.req.raw.headers);
    await enforceRateLimit(readDb(c), RATE_LIMITS.refreshIp, ip);
    await rejectReplayedToken(readDb(c), body.refreshToken);
    const rotated = await withTx(c, async (tx) => {
      const r = await rotateSession(tx, body.refreshToken, {
        subjectType: 'owner',
        deviceId: body.deviceId,
        ttlMs: OWNER_REFRESH_TTL_MS,
      });
      const owner = await tx.query.owners.findFirst({
        where: eq(owners.id, r.subjectId),
        columns: { status: true },
      });
      if (!owner || owner.status === 'disabled')
        throw new ApiError(403, 'owner_disabled', 'This account is disabled');
      const device = await tx.query.devices.findFirst({
        where: and(
          eq(devices.ownerId, r.subjectId),
          eq(devices.deviceId, body.deviceId),
          isNull(devices.revokedAt),
        ),
        columns: { id: true },
      });
      if (!device) throw unauthorized('Device signed out');
      await tx.update(devices).set({ lastSeen: new Date() }).where(eq(devices.id, device.id));
      return r;
    });
    const accessToken = await signAccessToken(c.env, {
      type: 'owner',
      id: rotated.subjectId,
      sessionId: rotated.sessionId,
      deviceId: body.deviceId,
    });
    return c.json({
      accessToken,
      accessExpiresIn: ACCESS_TTL_SECONDS,
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt.toISOString(),
    });
  })

  .post(
    '/logout',
    zValidator('json', z.object({ refreshToken: z.string().min(20).max(512) })),
    async (c) => {
      await withTx(c, (tx) => revokeSessionByToken(tx, c.req.valid('json').refreshToken));
      return c.json({ ok: true });
    },
  )

  /** Devices of the signed-in owner; lets them sign out other devices. */
  .get('/devices', requireOwner, async (c) => {
    const p = ownerOf(c);
    const rows = await readDb(c)
      .select({
        id: devices.id,
        deviceId: devices.deviceId,
        platform: devices.platform,
        model: devices.model,
        firstSeen: devices.firstSeen,
        lastSeen: devices.lastSeen,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.ownerId, p.id));
    return c.json({ items: rows.map((d) => ({ ...d, current: d.deviceId === p.deviceId })) });
  })

  .post(
    '/devices/:id/revoke',
    requireOwner,
    zValidator('param', z.object({ id: uuidSchema })),
    async (c) => {
      const p = ownerOf(c);
      const { id } = c.req.valid('param');
      await withTx(c, async (tx) => {
        const device = await tx.query.devices.findFirst({
          where: and(eq(devices.id, id), eq(devices.ownerId, p.id)),
        });
        if (!device) throw new ApiError(404, 'not_found', 'Device not found');
        await tx
          .update(devices)
          .set({ revokedAt: new Date(), pushToken: null })
          .where(eq(devices.id, device.id));
        await revokeChain(tx, 'owner', p.id, device.deviceId);
      });
      return c.json({ ok: true });
    },
  )

  .post('/devices/revoke-others', requireOwner, async (c) => {
    const p = ownerOf(c);
    await withTx(c, async (tx) => {
      const others = await tx
        .select({ id: devices.id, deviceId: devices.deviceId })
        .from(devices)
        .where(and(eq(devices.ownerId, p.id), isNull(devices.revokedAt)));
      for (const d of others) {
        if (d.deviceId === p.deviceId) continue;
        await tx
          .update(devices)
          .set({ revokedAt: new Date(), pushToken: null })
          .where(eq(devices.id, d.id));
        await revokeChain(tx, 'owner', p.id, d.deviceId);
      }
    });
    return c.json({ ok: true });
  });
