// Go-live blank start: empties every application table in the database that DATABASE_URL points
// at and creates the one admin who will sign in first. The schema and the migrations journal stay.
//
//   GOLIVE_ADMIN_EMAIL=ops@vamar.ae GOLIVE_ADMIN_NAME="Vamar Operations" pnpm golive:blank
//       prints what would be deleted and stops (dry run)
//   ... pnpm golive:blank --confirm
//       deletes it
//
// The admin is created as an invitation: the first Google sign-in with that (verified) email binds
// the account, and two-step login is required from the first session. Files in R2 (dispute
// attachments, cheque images, statements) are not touched; GOLIVE.md has the bucket command.
import './load-env.js';
import { sql } from 'drizzle-orm';
import { createNodeDb } from '../src/node.js';
import { uuidv7 } from '../src/schema/_common.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const email = process.env['GOLIVE_ADMIN_EMAIL']?.trim().toLowerCase();
const name = process.env['GOLIVE_ADMIN_NAME']?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
  console.error('Set GOLIVE_ADMIN_EMAIL and GOLIVE_ADMIN_NAME for the first admin account');
  process.exit(1);
}
const confirm = process.argv.includes('--confirm');
const { hostname, pathname } = new URL(url);
const host = `${hostname}${pathname}`;

type Row = Record<string, unknown>;
const rows = <T extends Row>(r: unknown): T[] => (r as { rows: T[] }).rows;

const { db, pool } = createNodeDb(url);
try {
  const tables = rows<{ tablename: string }>(
    await db.execute(sql`
      select tablename from pg_tables
      where schemaname = 'public' and tablename <> '__drizzle_migrations' order by tablename`),
  ).map((t) => t.tablename);
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [c] = rows<{ n: number }>(
      await db.execute(sql.raw(`select count(*)::int as n from "${t}"`)),
    );
    counts[t] = c?.n ?? 0;
  }
  console.info(`[${host}] rows now:`, counts);

  if (!confirm) {
    console.info(
      `Dry run. Re-run with --confirm to empty ${tables.length} tables on ${host} and create ` +
        `the admin ${email}.`,
    );
  } else {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`),
      );
      await tx.execute(sql`
        insert into staff_users (id, firebase_uid, email, name, role, totp_required)
        values (${uuidv7()}, ${`invite:${uuidv7()}`}, ${email}, ${name}, 'admin', true)`);
    });
    const [check] = rows<{ owners: number; staff: number }>(
      await db.execute(sql`
        select (select count(*)::int from owners) as owners,
               (select count(*)::int from staff_users) as staff`),
    );
    console.info(`[${host}] blank start done`, { ...check, admin: email });
  }
} finally {
  await pool.end();
}
