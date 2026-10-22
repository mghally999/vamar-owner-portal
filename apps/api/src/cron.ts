/**
 * The one daily cron (04:00 UTC = 08:00 Dubai):
 * 1. cheques due in exactly 3 days  -> push
 * 2. active contracts ending in exactly 60 / 30 days -> push
 * 3. mark active contracts past their end date as expired (with its audit row, in one transaction)
 * 4. retention: stale rate-limit windows, dead sessions, old notification rows
 *
 * Each step runs on its own: a failure is recorded in the summary and the next step still runs.
 * Notifications are idempotent through notification_log.dedupe_key and transport failures are
 * retried by the next run (see services/notifications.ts).
 */
import { and, eq, inArray, isNull, isNotNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  addDays,
  CHEQUE_REMINDER_DAYS,
  CONTRACT_ENDING_DAYS,
  ownerShareAmount,
  type PlainDate,
} from '@vamar/shared';
import { cronDb, type Db } from './db.js';
import type { Bindings } from './env.js';
import {
  deliver,
  type DeliveryReport,
  type PendingNotification,
} from './services/notifications.js';
import { log } from './util/log.js';
import { today } from './util/today.js';

const {
  cheques,
  contracts,
  units,
  buildings,
  unitOwnerships,
  owners,
  rateLimits,
  auditLog,
  sessions,
  notificationLog,
} = schema;

/** Rows older than these are deleted every night. */
export const RETENTION = {
  rateLimitWindowsMs: 24 * 60 * 60 * 1000,
  deadSessionsDays: 30,
  notificationLogDays: 365,
} as const;

export interface DailySummary extends DeliveryReport {
  date: PlainDate;
  dueReminders: number;
  notifications: number;
  expiredContracts: number;
  purged: { rateLimits: number; sessions: number; notifications: number };
  errors: string[];
}

export async function runDailyJobs(env: Bindings): Promise<DailySummary> {
  const t = today(env);
  const { db, close } = cronDb(env);
  const summary: DailySummary = {
    date: t,
    dueReminders: 0,
    notifications: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    expiredContracts: 0,
    purged: { rateLimits: 0, sessions: 0, notifications: 0 },
    errors: [],
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      summary.errors.push(`${name}: ${message}`);
      log('error', 'cron.step_failed', { step: name, error: message });
    }
  };
  try {
    await step('alerts', async () => {
      const pending = await collectAlerts(db, t);
      summary.dueReminders = pending.filter((p) => p.type === 'cheque_due_soon').length;
      summary.notifications = pending.length;
      const r = await deliver(env, db, pending);
      summary.sent = r.sent;
      summary.skipped = r.skipped;
      summary.failed = r.failed;
    });
    await step('expire', async () => {
      summary.expiredContracts = await expireContracts(db, t);
    });
    await step('retention', async () => {
      summary.purged = await purge(db);
    });
    log(summary.errors.length ? 'warn' : 'info', 'cron.daily', { ...summary });
    if (summary.errors.length) throw new Error(summary.errors.join(' | '));
    return summary;
  } finally {
    await close();
  }
}

/** Cheques due in 3 days and contracts ending in 60/30 days, fanned out to the current owners. */
async function collectAlerts(db: Db, t: PlainDate): Promise<PendingNotification[]> {
  const pending: PendingNotification[] = [];
  const dueDate = addDays(t, CHEQUE_REMINDER_DAYS);
  const due = await db
    .select({
      id: cheques.id,
      amountFils: cheques.amountFils,
      dueDate: cheques.dueDate,
      unitId: contracts.unitId,
      unitNo: units.unitNo,
      bAr: buildings.nameAr,
      bEn: buildings.nameEn,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(
      and(
        eq(cheques.status, 'upcoming'),
        eq(cheques.dueDate, dueDate),
        eq(contracts.status, 'active'),
        isNotNull(cheques.amountFils),
      ),
    );
  const endDates = CONTRACT_ENDING_DAYS.map((days) => ({ days, endDate: addDays(t, days) }));
  const ending = await db
    .select({
      id: contracts.id,
      endDate: contracts.endDate,
      unitId: contracts.unitId,
      unitNo: units.unitNo,
      bAr: buildings.nameAr,
      bEn: buildings.nameEn,
    })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(
      and(
        eq(contracts.status, 'active'),
        inArray(
          contracts.endDate,
          endDates.map((e) => e.endDate),
        ),
      ),
    );

  // One query for the owners of every unit involved (no per-row lookups).
  const unitIds = [...new Set([...due.map((q) => q.unitId), ...ending.map((k) => k.unitId)])];
  const ownersByUnit = new Map<string, { ownerId: string; shareBp: number; lang: 'ar' | 'en' }[]>();
  if (unitIds.length) {
    const rows = await db
      .select({
        unitId: unitOwnerships.unitId,
        ownerId: unitOwnerships.ownerId,
        shareBp: unitOwnerships.shareBp,
        lang: owners.preferredLang,
      })
      .from(unitOwnerships)
      .innerJoin(owners, eq(owners.id, unitOwnerships.ownerId))
      .where(
        and(
          inArray(unitOwnerships.unitId, unitIds),
          isNull(unitOwnerships.toDate),
          inArray(owners.status, ['active', 'invited']),
        ),
      );
    for (const r of rows) {
      const list = ownersByUnit.get(r.unitId) ?? [];
      list.push(r);
      ownersByUnit.set(r.unitId, list);
    }
  }
  const label = (lang: 'ar' | 'en', bAr: string, bEn: string, unitNo: string) =>
    lang === 'ar' ? `${bAr} ${unitNo}` : `${bEn} ${unitNo}`;

  for (const q of due) {
    for (const o of ownersByUnit.get(q.unitId) ?? []) {
      pending.push({
        ownerId: o.ownerId,
        type: 'cheque_due_soon',
        entityId: q.id,
        date: t,
        params: {
          type: 'cheque_due_soon',
          amountFils: ownerShareAmount(q.amountFils ?? 0, o.shareBp),
          dueDate: q.dueDate as PlainDate,
          unitLabel: label(o.lang, q.bAr, q.bEn, q.unitNo),
        },
      });
    }
  }
  for (const k of ending) {
    const days = endDates.find((e) => e.endDate === k.endDate)?.days;
    if (days === undefined) continue;
    const type = days === 60 ? 'contract_ending_60' : 'contract_ending_30';
    for (const o of ownersByUnit.get(k.unitId) ?? []) {
      pending.push({
        ownerId: o.ownerId,
        type,
        entityId: k.id,
        date: t,
        params: {
          type,
          endDate: k.endDate as PlainDate,
          unitLabel: label(o.lang, k.bAr, k.bEn, k.unitNo),
        },
      });
    }
  }
  return pending;
}

/** Active contracts past their end date become expired, with the audit row in the same transaction. */
async function expireContracts(db: Db, t: PlainDate): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(contracts)
      .set({ status: 'expired' })
      .where(and(eq(contracts.status, 'active'), lt(contracts.endDate, t)))
      .returning({ id: contracts.id });
    if (expired.length) {
      await tx.insert(auditLog).values({
        actorType: 'system',
        actorId: null,
        action: 'contract.expire',
        entityType: 'contract',
        entityId: null,
        after: { ids: expired.map((e) => e.id), date: t },
      });
    }
    return expired.length;
  });
}

/** Retention: short-lived counters, finished sessions and old notification rows. */
async function purge(db: Db): Promise<DailySummary['purged']> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const rl = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now - RETENTION.rateLimitWindowsMs)))
    .returning({ key: rateLimits.key });
  const sessionCutoff = new Date(now - RETENTION.deadSessionsDays * dayMs);
  const s = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, sessionCutoff),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, sessionCutoff)),
      ),
    )
    .returning({ id: sessions.id });
  const n = await db
    .delete(notificationLog)
    .where(
      and(
        lt(notificationLog.sentAt, new Date(now - RETENTION.notificationLogDays * dayMs)),
        sql`${notificationLog.result} not like 'failed:%'`,
      ),
    )
    .returning({ id: notificationLog.id });
  return { rateLimits: rl.length, sessions: s.length, notifications: n.length };
}
