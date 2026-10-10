// Restores the demo data in the database that DATABASE_URL points at (local or the live demo
// on Neon) without touching the schema: every table is truncated and the seed is re-run.
// Logins survive the reset: staff authenticator enrolment and Firebase binding (by email) and
// owner/staff sessions and devices (by phone / email) are captured first and re-attached to the
// freshly seeded rows, so the dashboard and the app stay signed in.
import './load-env.js';
import { sql } from 'drizzle-orm';
import { createNodeDb } from '../src/node.js';
import { seed } from '../src/seed/index.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const host = new URL(url).hostname;
const label = process.env['DEMO_RESET_LABEL'] ?? host;

type Row = Record<string, unknown>;
const rows = <T extends Row>(r: unknown): T[] => (r as { rows: T[] }).rows;

const { db, pool } = createNodeDb(url);
try {
  // 1. Capture what must survive.
  const staff = rows<{
    email: string;
    firebase_uid: string;
    totp_secret_enc: string | null;
    totp_enabled: boolean;
  }>(
    await db.execute(
      sql`select email, firebase_uid, totp_secret_enc, totp_enabled from staff_users`,
    ),
  );
  const devices = rows<Row & { phone_e164: string }>(
    await db.execute(sql`
      select d.*, o.phone_e164 from devices d join owners o on o.id = d.owner_id`),
  );
  const ownerSessions = rows<Row & { phone_e164: string }>(
    await db.execute(sql`
      select s.*, o.phone_e164 from sessions s join owners o on o.id = s.subject_id
      where s.subject_type = 'owner' and s.revoked_at is null and s.expires_at > now()`),
  );
  const staffSessions = rows<Row & { email: string }>(
    await db.execute(sql`
      select s.*, u.email from sessions s join staff_users u on u.id = s.subject_id
      where s.subject_type = 'staff' and s.revoked_at is null and s.expires_at > now()`),
  );

  // 2. Truncate every application table (migrations journal stays).
  const tables = rows<{ tablename: string }>(
    await db.execute(sql`
      select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`),
  ).map((t) => t.tablename);
  await db.execute(
    sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`),
  );

  // 3. Seed again.
  const summary = await seed(db);

  // 4. Re-attach logins to the new rows.
  for (const s of staff) {
    await db.execute(sql`
      update staff_users set firebase_uid = ${s.firebase_uid}, totp_secret_enc = ${s.totp_secret_enc},
        totp_enabled = ${s.totp_enabled} where email = ${s.email}`);
  }
  const ownerIds = new Map(
    rows<{ id: string; phone_e164: string }>(
      await db.execute(sql`select id, phone_e164 from owners`),
    ).map((o) => [o.phone_e164, o.id]),
  );
  const staffIds = new Map(
    rows<{ id: string; email: string }>(
      await db.execute(sql`select id, email from staff_users`),
    ).map((u) => [u.email, u.id]),
  );
  const insert = async (table: string, row: Row, drop: string[]) => {
    const cols = Object.keys(row).filter((c) => !drop.includes(c));
    const names = cols.map((c) => `"${c}"`).join(', ');
    const values = cols.map((c) => row[c]);
    const params = values.map((_, i) => `$${i + 1}`).join(', ');
    await pool.query(
      `insert into "${table}" (${names}) values (${params}) on conflict do nothing`,
      values,
    );
  };
  let kept = 0;
  for (const d of devices) {
    const id = ownerIds.get(d.phone_e164);
    if (id) {
      await insert('devices', { ...d, owner_id: id }, ['phone_e164']);
      kept++;
    }
  }
  for (const s of ownerSessions) {
    const id = ownerIds.get(s.phone_e164);
    if (id) {
      await insert('sessions', { ...s, subject_id: id }, ['phone_e164']);
      kept++;
    }
  }
  for (const s of staffSessions) {
    const id = staffIds.get(s.email);
    if (id) {
      await insert('sessions', { ...s, subject_id: id }, ['email']);
      kept++;
    }
  }
  console.info(`[${label}] demo data restored`, { ...summary, loginsKept: kept });
} finally {
  await pool.end();
}
