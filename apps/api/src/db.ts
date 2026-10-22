/**
 * Database access for one request.
 *
 * Deployed (Neon): reads go through the Neon HTTP driver (one fetch per query, no connection to
 * hold), and multi-statement writes open a per-request Pool over WebSocket so a real transaction
 * is possible; the pool is closed with `ctx.waitUntil(pool.end())`.
 *
 * Local development and tests: the Neon drivers only speak to Neon's proxy, so when DATABASE_URL
 * points at localhost we use `pg` (works on Workers with nodejs_compat), and tests inject a
 * ready-made PGlite database via `env.TEST_DB`. Service code only ever sees `Db` / `Tx`.
 */
import { neon, Pool as NeonPool } from '@neondatabase/serverless';
import { sql, type ExtractTablesWithRelations, type SQL } from 'drizzle-orm';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { AnyPgColumn, PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { schema } from '@vamar/db';
import pg from 'pg';
import type { Context } from 'hono';
import type { AppEnv, Bindings } from './env.js';

export type Schema = typeof schema;
export type Relations = ExtractTablesWithRelations<Schema>;
export type Db = PgDatabase<PgQueryResultHKT, Schema, Relations>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, Relations>;
/** Either a database or an open transaction. Services accept this. */
export type Dbx = Db | Tx;

/** A Neon wake-up takes about a second; anything beyond this is reported, not waited for. */
const NEON_CONNECT_TIMEOUT_MS = 10_000;

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Read-only database for this request. */
export function readDb(c: Context<AppEnv>): Db {
  const env = c.env;
  if (env.TEST_DB) return env.TEST_DB;
  if (isLocal(env.DATABASE_URL)) return localPool(c);
  return drizzleNeonHttp({ client: neon(env.DATABASE_URL), schema, casing: 'snake_case' });
}

/**
 * Run `fn` inside one database transaction. Everything a staff action changes (rows, cheque
 * events, audit log) goes through here so it is all-or-nothing.
 */
export async function withTx<T>(c: Context<AppEnv>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const env = c.env;
  if (env.TEST_DB) return env.TEST_DB.transaction((tx) => fn(tx));
  if (isLocal(env.DATABASE_URL)) return localPool(c).transaction((tx) => fn(tx));
  const pool = new NeonPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: NEON_CONNECT_TIMEOUT_MS,
  });
  const db = drizzleNeon({ client: pool, schema, casing: 'snake_case' });
  try {
    return await db.transaction((tx) => fn(tx as unknown as Tx));
  } finally {
    c.executionCtx.waitUntil(pool.end());
  }
}

/**
 * Local development runs on Node (or wrangler's local runtime), where one long-lived pg pool per
 * process is the right shape; it is never used in deployed Workers.
 */
const localPools = new Map<string, Db>();

function localPool(c: Context<AppEnv>): Db {
  const url = c.env.DATABASE_URL;
  let db = localPools.get(url);
  if (!db) {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    db = drizzlePg({ client: pool, schema, casing: 'snake_case' });
    localPools.set(url, db);
  }
  return db;
}

/** Used by the cron handler, which has no Hono context. */
export function cronDb(env: Bindings): { db: Db; close: () => Promise<void> } {
  if (env.TEST_DB) return { db: env.TEST_DB, close: () => Promise.resolve() };
  if (isLocal(env.DATABASE_URL)) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
    return {
      db: drizzlePg({ client: pool, schema, casing: 'snake_case' }),
      close: () => pool.end(),
    };
  }
  const pool = new NeonPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: NEON_CONNECT_TIMEOUT_MS,
  });
  return {
    db: drizzleNeon({ client: pool, schema, casing: 'snake_case' }),
    close: () => pool.end(),
  };
}

/**
 * Natural ordering for unit numbers: "801" before "1204", "G-02" with the shops, "W-1" with the
 * warehouses. Sorts by the letters, then the numeric part, then the raw text.
 */
export function unitNoOrder(col: AnyPgColumn): SQL[] {
  return [
    sql`regexp_replace(${col}, '[0-9]+', '', 'g')`,
    sql`nullif(regexp_replace(${col}, '[^0-9]', '', 'g'), '')::int`,
    sql`${col}`,
  ];
}
