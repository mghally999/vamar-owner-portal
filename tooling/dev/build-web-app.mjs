#!/usr/bin/env node
/**
 * Exports the owner app for the web into apps/dashboard/dist/app, served by the Worker at /app.
 * Run after the dashboard build (which empties dist). The Firebase web config is the dashboard's
 * public one (apps/dashboard/.env.production, or VITE_FIREBASE_* in the environment); the API is
 * the same origin.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const envFile = join(root, 'apps', 'dashboard', '.env.production');
const fromFile = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .map((l) => /^(VITE_FIREBASE_[A-Z_]+)=(.*)$/.exec(l.trim()))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    )
  : {};
const get = (k) => process.env[k] ?? fromFile[k];
const env = {
  ...process.env,
  NODE_ENV: 'production',
  CI: '1',
  EXPO_PUBLIC_API_BASE: '',
  EXPO_PUBLIC_FIREBASE_API_KEY: get('VITE_FIREBASE_API_KEY'),
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: get('VITE_FIREBASE_AUTH_DOMAIN'),
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: get('VITE_FIREBASE_PROJECT_ID'),
  EXPO_PUBLIC_FIREBASE_APP_ID: get('VITE_FIREBASE_APP_ID'),
};
for (const k of ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID']) {
  if (!env[k])
    throw new Error(`${k} is not set (apps/dashboard/.env.production or VITE_FIREBASE_*)`);
}
if (!existsSync(join(root, 'apps', 'dashboard', 'dist', 'index.html'))) {
  throw new Error('build the dashboard first (pnpm --filter @vamar/dashboard build)');
}
execSync('npx expo export --platform web --output-dir ../dashboard/dist/app', {
  cwd: join(root, 'apps', 'mobile'),
  env,
  stdio: 'inherit',
});
console.log('owner web app exported to apps/dashboard/dist/app');
