// Applies pending SQL migrations from ./migrations. Used locally and by CI; on Neon the same
// script runs with DATABASE_URL pointing at the branch to migrate.
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from '../src/node.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set (copy .env.example to .env)');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const { db, pool } = createNodeDb(url);
try {
  await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });
  console.info('migrations applied');
} finally {
  await pool.end();
}
