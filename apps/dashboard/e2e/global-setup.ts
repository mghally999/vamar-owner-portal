/**
 * Playwright global setup for the local demo stack.
 *
 * 1. Clears rate-limit counters and resets the authenticator (TOTP) of the demo staff users in the LOCAL database so every run
 *    goes through enrolment and the helper can read the secret from the screen.
 * 2. Makes sure the two demo staff accounts exist in the Firebase Auth emulator (the emulator
 *    forgets them when it is killed without exporting).
 *
 * Refuses to touch anything that is not localhost.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const STAFF = [
  { localId: 'seed-staff-admin', email: 'admin@vamar.test' },
  { localId: 'seed-staff-entry', email: 'entry@vamar.test' },
];
const PASSWORD = 'Vamar2026!';

function databaseUrl(): string {
  if (process.env['DATABASE_URL']) return process.env['DATABASE_URL'];
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
  if (existsSync(envFile)) {
    const m = /^DATABASE_URL=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
    if (m?.[1]) return m[1].trim();
  }
  return 'postgres://vamar:vamar@localhost:5433/vamar';
}

export default async function globalSetup(): Promise<void> {
  const url = databaseUrl();
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`e2e global setup only runs against a local database, got ${host}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `update staff_users
         set totp_enabled = false, totp_secret_enc = null, totp_failures = 0, totp_locked_until = null
       where email = any($1::text[])`,
      [STAFF.map((s) => s.email)],
    );
    // Earlier failed runs leave rate-limit and lockout counters behind; this is the local demo DB.
    await client.query('delete from rate_limits');
  } finally {
    await client.end();
  }

  const emulator = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099';
  for (const s of STAFF) {
    const res = await fetch(
      `http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
        body: JSON.stringify({ ...s, password: PASSWORD, emailVerified: true }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = body.error?.message ?? '';
      if (!/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(msg)) {
        throw new Error(`could not create ${s.email} in the Auth emulator: ${msg || res.status}`);
      }
    }
  }
}
