/**
 * Runtime configuration checks. The Worker refuses to serve when a required secret is missing, a
 * development placeholder reached production, or the Firebase emulator bypass is switched on in
 * production. Everything here is cheap string inspection, run once per request.
 */
import type { Bindings } from './env.js';
import { fromBase64 } from './util/crypto.js';

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;

/** Values shipped in `.dev.vars.example` and the dev server; never valid in production. */
export const PLACEHOLDER_SECRETS: readonly string[] = [
  'dev-only-change-me-dev-only-change-me-dev-only',
  'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyEh',
];

export const MIN_JWT_SECRET_LENGTH = 32;

export function isProduction(env: Pick<Bindings, 'APP_ENV'>): boolean {
  return env.APP_ENV === 'production';
}

/** Staging and production: real Firebase, real secrets, no development shortcuts. */
export function isDeployed(env: Pick<Bindings, 'APP_ENV'>): boolean {
  return env.APP_ENV === 'production' || env.APP_ENV === 'staging';
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Returns a list of problems; empty when the environment is usable. */
export function validateEnv(env: Partial<Bindings>): string[] {
  const problems: string[] = [];
  const appEnv = env.APP_ENV;
  if (!appEnv || !(APP_ENVS as readonly string[]).includes(appEnv)) {
    problems.push(`APP_ENV must be one of ${APP_ENVS.join(', ')}`);
  }
  const prod = appEnv === 'production' || appEnv === 'staging';

  if (!env.TEST_DB && !env.DATABASE_URL) problems.push('DATABASE_URL is missing');
  if (prod && env.DATABASE_URL && isLocalUrl(env.DATABASE_URL)) {
    problems.push('DATABASE_URL points at localhost in production');
  }

  const jwt = env.JWT_SECRET ?? '';
  if (jwt.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  const totp = env.TOTP_ENC_KEY ?? '';
  if (!totp) {
    problems.push('TOTP_ENC_KEY is missing');
  } else {
    try {
      if (fromBase64(totp).length < 32) problems.push('TOTP_ENC_KEY must encode at least 32 bytes');
    } catch {
      problems.push('TOTP_ENC_KEY is not base64');
    }
  }
  if (!env.FIREBASE_PROJECT_ID) problems.push('FIREBASE_PROJECT_ID is missing');

  if (prod) {
    for (const value of [jwt, totp]) {
      if (PLACEHOLDER_SECRETS.includes(value))
        problems.push('a development placeholder secret is set');
    }
    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      problems.push('FIREBASE_AUTH_EMULATOR_HOST must not be set in production');
    }
    if (env.TEST_DB) problems.push('TEST_DB must not be set in production');
  }
  return problems;
}

/**
 * Content-Security-Policy `connect-src` for the Worker's own responses. The emulator hosts are
 * only ever needed outside production.
 */
export function cspConnectSrc(env: Pick<Bindings, 'APP_ENV'>): string[] {
  const list = ["'self'", 'https://*.googleapis.com', 'https://*.firebaseapp.com'];
  if (!isDeployed(env)) list.push('http://127.0.0.1:9099', 'http://localhost:9099');
  return list;
}
