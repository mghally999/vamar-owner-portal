// Local only: drop everything, re-run migrations, re-seed. Refuses to run against a non-local host.
import './load-env.js';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from '../src/node.js';
import { seed } from '../src/seed/index.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
  console.error(`Refusing to reset a non-local database (${host})`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const { db, pool } = createNodeDb(url);
try {
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });
  const summary = await seed(db);
  console.info('database reset and seeded', summary);
} finally {
  await pool.end();
}
