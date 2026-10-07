/**
 * Node (local dev, scripts, integration tests) database client using `pg`.
 * Not imported by the Worker.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type NodeDb = NodePgDatabase<typeof schema>;

export function createNodeDb(databaseUrl: string): { db: NodeDb; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  return { db: drizzle({ client: pool, schema, casing: 'snake_case' }), pool };
}
