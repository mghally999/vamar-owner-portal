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
  APP_ENV: 'development' | 'test' | 'production';
  /** Tests inject a ready database instead of a connection string. */
  TEST_DB?: Db;
  /** Tests can pin the business date. */
  TEST_TODAY?: string;
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
