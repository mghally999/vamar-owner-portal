/**
 * Fixed-window rate limits stored in Postgres (no KV on the free plan is needed). One row per
 * key; the window restarts when it is older than `windowMs`. Used on auth and TOTP endpoints,
 * keyed per IP and per phone/email. Callers run this on an autocommit connection, before any
 * transaction, so a refused attempt still counts.
 */
import { sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { Dbx } from '../db.js';
import { ApiError } from '../errors.js';

export interface RateLimitRule {
  /** e.g. "owner_exchange" */
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  ownerExchangeIp: { name: 'owner_exchange:ip', limit: 20, windowMs: 10 * 60 * 1000 },
  ownerExchangePhone: { name: 'owner_exchange:phone', limit: 10, windowMs: 10 * 60 * 1000 },
  refreshIp: { name: 'refresh:ip', limit: 60, windowMs: 10 * 60 * 1000 },
  staffExchangeIp: { name: 'staff_exchange:ip', limit: 20, windowMs: 10 * 60 * 1000 },
  staffExchangeEmail: { name: 'staff_exchange:email', limit: 10, windowMs: 10 * 60 * 1000 },
  totpIp: { name: 'totp:ip', limit: 30, windowMs: 15 * 60 * 1000 },
  totpUser: { name: 'totp:user', limit: 10, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Increment the counter for `rule:subject` and throw 429 when over the limit.
 * One statement: insert or bump, resetting the window when it has elapsed. Timestamps are passed
 * as ISO strings with explicit casts so every driver (pg, Neon, PGlite) binds them the same way.
 */
export async function enforceRateLimit(
  db: Dbx,
  rule: RateLimitRule,
  subject: string,
): Promise<void> {
  const key = `${rule.name}:${subject}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - rule.windowMs).toISOString();
  const rows = await db
    .insert(schema.rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`CASE WHEN ${schema.rateLimits.windowStart} < ${cutoff}::timestamptz THEN 1 ELSE ${schema.rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${schema.rateLimits.windowStart} < ${cutoff}::timestamptz THEN ${nowIso}::timestamptz ELSE ${schema.rateLimits.windowStart} END`,
      },
    })
    .returning({ count: schema.rateLimits.count });
  const count = rows[0]?.count ?? 1;
  if (count > rule.limit) {
    throw new ApiError(429, 'rate_limited', 'Too many attempts, try again later', {
      retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
    });
  }
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
