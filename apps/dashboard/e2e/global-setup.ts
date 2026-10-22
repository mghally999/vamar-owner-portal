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
import { unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLocalDb } from './db';

const STAFF = [
  { localId: 'seed-staff-admin', email: 'admin@vamar.test' },
  { localId: 'seed-staff-entry', email: 'entry@vamar.test' },
];
const PASSWORD = 'Vamar2026!';

export default async function globalSetup(): Promise<void> {
  // Secrets from a previous run are invalid once the authenticator is reset below.
  try {
    unlinkSync(resolve(dirname(fileURLToPath(import.meta.url)), '.totp-secrets.json'));
  } catch {
    // nothing to remove
  }
  await withLocalDb(async (client) => {
    await client.query(
      `update staff_users
         set totp_enabled = false, totp_secret_enc = null, totp_failures = 0, totp_locked_until = null
       where email = any($1::text[])`,
      [STAFF.map((s) => s.email)],
    );
    // Earlier failed runs leave rate-limit and lockout counters behind; this is the local demo DB.
    await client.query('delete from rate_limits');
  });

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
