/**
 * Staff TOTP (RFC 6238) with the `otpauth` library. The secret is stored AES-GCM encrypted
 * with TOTP_ENC_KEY; it is only ever decrypted in memory to verify a code.
 */
import { Secret, TOTP } from 'otpauth';
import { decryptString, encryptString } from '../util/crypto.js';

export const TOTP_ISSUER = 'Vamar';
export const TOTP_MAX_FAILURES = 5;
export const TOTP_LOCK_MS = 15 * 60 * 1000;

export interface TotpEnrollment {
  /** otpauth:// URI for the QR code. */
  uri: string;
  /** Base32 secret for manual entry. */
  secretBase32: string;
  /** Encrypted secret to store. */
  secretEnc: string;
}

export async function createTotpEnrollment(email: string, encKey: string): Promise<TotpEnrollment> {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  return {
    uri: totp.toString(),
    secretBase32: secret.base32,
    secretEnc: await encryptString(secret.base32, encKey),
  };
}

export const TOTP_PERIOD_SECONDS = 30;

/**
 * Accepts the current window and one step either side (clock drift). Returns the matched time
 * step so the caller can refuse a code that was already used (RFC 6238 single use).
 */
export async function verifyTotpCode(
  secretEnc: string,
  code: string,
  encKey: string,
  now = Date.now(),
): Promise<{ ok: true; step: number } | { ok: false }> {
  const base32 = await decryptString(secretEnc, encKey);
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(base32),
  });
  const delta = totp.validate({ token: code, window: 1, timestamp: now });
  if (delta === null) return { ok: false };
  return { ok: true, step: Math.floor(now / (TOTP_PERIOD_SECONDS * 1000)) + delta };
}

/** For tests and the demo: compute the current code from a base32 secret. */
export function currentTotpCode(secretBase32: string, timestamp = Date.now()): string {
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate({ timestamp });
}
