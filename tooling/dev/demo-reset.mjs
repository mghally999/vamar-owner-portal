#!/usr/bin/env node
/**
 * `pnpm demo:reset`: puts the demo data back to its starting state after a rehearsal, on the
 * local database (DATABASE_URL from .env) and on the live demo database when
 * `.local/neon.env` exists on this machine (gitignored; holds the Neon owner connection string).
 * Logins survive: staff authenticator, dashboard sessions, owner app sessions and devices.
 *
 *   pnpm demo:reset            local + live (if .local/neon.env is present)
 *   pnpm demo:reset --local    local only
 *   pnpm demo:reset --live     live only
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const wantLocal = args.size === 0 || args.has('--local');
const wantLive = args.size === 0 || args.has('--live');

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function run(label, databaseUrl) {
  const r = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@vamar/db', 'exec', 'tsx', 'scripts/demo-reset.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, DATABASE_URL: databaseUrl, DEMO_RESET_LABEL: label },
    },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (wantLocal) {
  const local = existsSync(join(root, '.env')) ? parseEnv(join(root, '.env')) : {};
  run(
    'local',
    process.env.DATABASE_URL ?? local.DATABASE_URL ?? 'postgres://vamar:vamar@localhost:5433/vamar',
  );
}
if (wantLive) {
  const file = join(root, '.local', 'neon.env');
  if (!existsSync(file)) {
    console.log('[live] skipped: .local/neon.env not found on this machine');
  } else {
    const live = parseEnv(file);
    if (!live.DATABASE_URL) {
      console.error('[live] .local/neon.env has no DATABASE_URL');
      process.exit(1);
    }
    run('live', live.DATABASE_URL);
  }
}
