/**
 * Database clients for Cloudflare Workers (Neon).
 *
 * - Reads: `createHttpDb` uses the Neon HTTP driver: one fetch per query, no connection to
 *   keep alive, ideal for the 10 ms CPU budget.
 * - Multi-statement writes: `createPoolDb` opens a per-request `Pool` over WebSocket so a real
 *   transaction is possible. The caller must `ctx.waitUntil(pool.end())` after the response.
 *
 * Local development and tests use `./node.js` (plain `pg`), which produces the same Drizzle
 * database type over the same schema, so service code is driver-agnostic.
 */
import { neon, Pool } from '@neondatabase/serverless';
import { drizzle as drizzleHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type HttpDb = NeonHttpDatabase<Schema>;
export type PoolDb = NeonDatabase<Schema>;

export function createHttpDb(databaseUrl: string): HttpDb {
  return drizzleHttp({ client: neon(databaseUrl), schema, casing: 'snake_case' });
}

export function createPoolDb(databaseUrl: string): { db: PoolDb; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  return { db: drizzlePool({ client: pool, schema, casing: 'snake_case' }), pool };
}

export { schema };
