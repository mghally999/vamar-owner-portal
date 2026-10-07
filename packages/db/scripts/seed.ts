// Seeds realistic demo data into an already-migrated database. Idempotent: refuses to run
// if owners already exist (use `pnpm db:reset` locally to start over).
import './load-env.js';
import { count } from 'drizzle-orm';
import { createNodeDb } from '../src/node.js';
import { owners } from '../src/schema/index.js';
import { seed } from '../src/seed/index.js';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, pool } = createNodeDb(url);
try {
  const [row] = await db.select({ n: count() }).from(owners);
  if ((row?.n ?? 0) > 0) {
    console.error('database already has owners; run `pnpm db:reset` to reseed locally');
    process.exit(1);
  }
  const summary = await seed(db);
  console.info('seeded', summary);
} finally {
  await pool.end();
}
