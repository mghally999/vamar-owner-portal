/** Local-database helpers for the e2e suite. Refuse anything that is not localhost. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export function databaseUrl(): string {
  if (process.env['DATABASE_URL']) return process.env['DATABASE_URL'];
  const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
  if (existsSync(envFile)) {
    const m = /^DATABASE_URL=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
    if (m?.[1]) return m[1].trim();
  }
  return 'postgres://vamar:vamar@localhost:5433/vamar';
}

export async function withLocalDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = databaseUrl();
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`e2e helpers only touch a local database, got ${host}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * The suite signs the same staff member in more often than the per-account sign-in limit allows
 * in ten minutes (that limit is the product behaviour and stays). Clear only the sign-in counters
 * of the test accounts before each sign-in.
 */
export async function resetLoginCounters(email: string): Promise<void> {
  await withLocalDb((c) =>
    c.query(`delete from rate_limits where key like $1 or key like 'staff_exchange:ip:%'`, [
      `staff_exchange:email:${email}%`,
    ]),
  );
}
