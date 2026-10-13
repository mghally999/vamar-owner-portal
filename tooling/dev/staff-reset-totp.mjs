#!/usr/bin/env node
/**
 * pnpm staff:reset-totp <email> [--live] [--off|--on]
 *
 * Resets a staff member's authenticator (the next sign-in shows the QR enrolment screen) and
 * clears the lockout and rate-limit counters. `--live` targets the live database through
 * `.local/neon.env` (gitignored, dev machine only); the default is the local database.
 * `--off` also switches 2-step login off for that account (demo accounts during a trial only),
 * `--on` switches it back on (the default for every real staff account).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.toLowerCase();
if (!email) {
  console.error('usage: pnpm staff:reset-totp <email> [--live] [--off|--on]');
  process.exit(2);
}
const live = args.includes('--live');
const totpRequired = args.includes('--off') ? false : args.includes('--on') ? true : null;

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const envFile = live ? join(root, '.local', 'neon.env') : join(root, '.env');
if (live && !existsSync(envFile)) {
  console.error('.local/neon.env not found; the live reset only runs from the dev machine');
  process.exit(1);
}
const url =
  (live
    ? parseEnv(envFile).DATABASE_URL
    : (process.env.DATABASE_URL ?? parseEnv(envFile).DATABASE_URL)) ??
  'postgres://vamar:vamar@localhost:5433/vamar';

const require = createRequire(join(root, 'packages', 'db', 'package.json'));
const { Client } = require('pg');
const client = new Client({ connectionString: url });
await client.connect();
try {
  const set = [
    'totp_enabled = false',
    'totp_secret_enc = null',
    'totp_failures = 0',
    'totp_locked_until = null',
  ];
  if (totpRequired !== null) set.push(`totp_required = ${totpRequired}`);
  const r = await client.query(
    `update staff_users set ${set.join(', ')} where email = $1 returning email, role, totp_required`,
    [email],
  );
  if (r.rowCount === 0) {
    console.error(`no staff user with email ${email}`);
    process.exit(1);
  }
  await client.query('delete from rate_limits');
  const row = r.rows[0];
  console.log(
    `[${live ? 'live' : 'local'}] authenticator reset for ${row.email} (${row.role}); 2-step login ${row.totp_required ? 'required' : 'OFF'}`,
  );
} finally {
  await client.end();
}
