import type { Db } from './db.js';

/** Worker bindings, vars and secrets. */
export interface Bindings {
  ASSETS?: Fetcher;
  FILES: R2Bucket;
  DATABASE_URL: string;
  JWT_SECRET: string;
  TOTP_ENC_KEY: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  EXPO_ACCESS_TOKEN?: string;
  ALLOWED_PHONE_COUNTRIES: string;
  APP_ENV: 'development' | 'test' | 'staging' | 'production';
  /**
   * "true" only during the client trial: the listed demo staff accounts may then sign in without
   * the authenticator step (config.ts DEMO_TRIAL_EMAILS). Set to "false" on go-live day.
   */
  DEMO_TRIAL?: string;
  /** Error reporting (optional): events go to Sentry when set. */
  SENTRY_DSN?: string;
  /** Newest owner app version and the oldest one still allowed to sign in (semver). */
  APP_LATEST_VERSION?: string;
  APP_MIN_VERSION?: string;
  /** Git commit of the deployed build, set by the deploy workflow (`--var RELEASE:<sha>`). */
  RELEASE?: string;
  /** Tests inject a ready database instead of a connection string. */
  TEST_DB?: Db;
  /** Tests can pin the business date. */
  TEST_TODAY?: string;
  /** Tests choose the push transport outcome instead of calling Expo. */
  TEST_PUSH?: 'ok' | 'fail';
}

export interface OwnerPrincipal {
  type: 'owner';
  id: string;
  sessionId: string;
  deviceId: string | null;
}

export interface StaffPrincipal {
  type: 'staff';
  id: string;
  sessionId: string;
  role: 'admin' | 'editor' | 'viewer';
  mfa: boolean;
}

export type Principal = OwnerPrincipal | StaffPrincipal;

export interface Variables {
  principal: Principal;
  requestId: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
