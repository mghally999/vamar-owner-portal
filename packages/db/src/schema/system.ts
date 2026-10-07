import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, instant } from './_common.js';
import { auditActorType, importStatus } from './enums.js';
import { staffUsers } from './staff.js';

/**
 * Append-only. The runtime role (vamar_app) has INSERT and SELECT only on this table;
 * the grant lives in the migration so it applies to Neon as well as local Docker.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorType: auditActorType().notNull(),
    actorId: uuid(),
    /** e.g. "cheque.status_change", "owner.create", "contract.activate" */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
    at: instant().notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.at),
    index('audit_log_actor_idx').on(t.actorType, t.actorId, t.at),
    index('audit_log_at_idx').on(t.at),
  ],
);

export const imports = pgTable('imports', {
  id: id(),
  fileName: text().notNull(),
  rowsTotal: integer().notNull().default(0),
  rowsOk: integer().notNull().default(0),
  rowsFailed: integer().notNull().default(0),
  status: importStatus().notNull().default('validating'),
  /** Client-supplied idempotency key so a retried commit never duplicates rows. */
  idempotencyKey: text().unique(),
  createdBy: uuid().references(() => staffUsers.id),
  createdAt: createdAt(),
});

/**
 * Fixed-window rate limits for auth and TOTP endpoints, keyed per IP and per phone/email.
 * Rows are short-lived; the cron deletes windows older than one day.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** e.g. "owner_exchange:ip:203.0.113.5" or "totp:email:a@b.com" */
    key: text().primaryKey(),
    windowStart: instant().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [index('rate_limits_window_idx').on(t.windowStart)],
);
