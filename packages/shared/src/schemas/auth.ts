import { z } from 'zod';
import { devicePlatformSchema } from './enums.js';

/** Device identity sent by the app on every auth call. `deviceId` is generated once per install. */
export const deviceInfoSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  platform: devicePlatformSchema,
  /** e.g. "iPhone 15" or "Samsung SM-S918B", shown in the devices list and login alerts. */
  model: z.string().trim().max(120).default(''),
  pushToken: z.string().trim().max(256).nullable().default(null),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const ownerExchangeSchema = z.object({
  firebaseIdToken: z.string().min(20).max(4096),
  device: deviceInfoSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
  deviceId: z.string().trim().min(8).max(128),
});

export const staffExchangeSchema = z.object({
  firebaseIdToken: z.string().min(20).max(4096),
});

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, { message: 'Enter the 6-digit code' }),
});

export const registerPushTokenSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  pushToken: z.string().trim().min(10).max(256),
});

/** Claims in our own access JWT (HS256, 15 minutes). */
export const accessClaimsSchema = z.object({
  sub: z.uuid(),
  typ: z.enum(['owner', 'staff']),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  /** Session id so a revoked refresh chain can invalidate access tokens on sensitive calls. */
  sid: z.uuid(),
  /** TOTP completed (staff only). Staff tokens without this may only call TOTP endpoints. */
  mfa: z.boolean().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessClaims = z.infer<typeof accessClaimsSchema>;
