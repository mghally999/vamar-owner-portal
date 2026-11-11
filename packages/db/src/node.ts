/**
 * Node (local dev, scripts, integration tests) database client using `pg`.
 * Not imported by the Worker.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type NodeDb = NodePgDatabase<typeof schema>;

export function createNodeDb(databaseUrl: string): { db: NodeDb; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    // Neon and home routers drop connections left idle; keep-alives hold the active ones and idle
    // ones are closed first, so a long script (the demo reset) never inherits a dead connection.
    keepAlive: true,
    idleTimeoutMillis: 10_000,
  });
  // A dropped idle connection is an 'error' event on the pool: without a listener Node treats it as
  // fatal and kills the script mid-transaction. The pool replaces the connection on the next query.
  pool.on('error', (err) => {
    console.warn(`database connection dropped while idle: ${err.message}`);
  });
  return { db: drizzle({ client: pool, schema, casing: 'snake_case' }), pool };
}
