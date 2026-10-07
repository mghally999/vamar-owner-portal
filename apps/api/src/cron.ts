/**
 * The one daily cron (04:00 UTC = 08:00 Dubai):
 * 1. cheques due in exactly 3 days  -> push
 * 2. active contracts ending in exactly 60 / 30 days -> push
 * 3. mark active contracts past their end date as expired (+ cheque timeline untouched)
 * 4. purge stale rate-limit windows
 * Everything is idempotent through notification_log.dedupe_key.
 */
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays, CHEQUE_REMINDER_DAYS, CONTRACT_ENDING_DAYS, type PlainDate } from '@vamar/shared';
import { cronDb } from './db.js';
import type { Bindings } from './env.js';
import { deliver, type PendingNotification } from './services/notifications.js';
import { log } from './util/log.js';
import { today } from './util/today.js';

const { cheques, contracts, units, buildings, unitOwnerships, owners, rateLimits, auditLog } =
  schema;

export async function runDailyJobs(env: Bindings) {
  const t = today(env);
  const { db, close } = cronDb(env);
  try {
    const pending: PendingNotification[] = [];

    // 1. Cheques due in exactly 3 days
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
          sql`${cheques.amountFils} is not null`,
        ),
      );
    for (const q of due) {
      for (const o of await ownersOf(db, q.unitId)) {
        pending.push({
          ownerId: o.ownerId,
          type: 'cheque_due_soon',
          entityId: q.id,
          date: t,
          params: {
            type: 'cheque_due_soon',
            amountFils: share(q.amountFils ?? 0, o.shareBp),
            dueDate: q.dueDate as PlainDate,
            unitLabel: o.lang === 'ar' ? `${q.bAr} ${q.unitNo}` : `${q.bEn} ${q.unitNo}`,
          },
        });
      }
    }

    // 2. Contracts ending in 60 / 30 days
    for (const days of CONTRACT_ENDING_DAYS) {
      const endDate = addDays(t, days);
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
        .where(and(eq(contracts.status, 'active'), eq(contracts.endDate, endDate)));
      for (const k of ending) {
        for (const o of await ownersOf(db, k.unitId)) {
          const type = days === 60 ? 'contract_ending_60' : 'contract_ending_30';
          pending.push({
            ownerId: o.ownerId,
            type,
            entityId: k.id,
            date: t,
            params: {
              type,
              endDate: k.endDate as PlainDate,
              unitLabel: o.lang === 'ar' ? `${k.bAr} ${k.unitNo}` : `${k.bEn} ${k.unitNo}`,
            },
          });
        }
      }
    }

    const sent = await deliver(env, db, pending);

    // 3. Expire contracts
    const expired = await db
      .update(contracts)
      .set({ status: 'expired' })
      .where(and(eq(contracts.status, 'active'), lt(contracts.endDate, t)))
      .returning({ id: contracts.id });
    if (expired.length) {
      await db
        .insert(auditLog)
        .values({
          actorType: 'system',
          actorId: null,
          action: 'contract.expire',
          entityType: 'contract',
          entityId: null,
          after: { ids: expired.map((e) => e.id), date: t },
        });
    }

    // 4. Rate limit cleanup (windows older than a day)
    await db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 60 * 60 * 1000)));

    const summary = {
      date: t,
      dueReminders: due.length,
      notifications: pending.length,
      ...sent,
      expiredContracts: expired.length,
    };
    log('info', 'cron.daily', summary);
    return summary;
  } finally {
    await close();
  }
}

async function ownersOf(db: ReturnType<typeof cronDb>['db'], unitId: string) {
  return db
    .select({
      ownerId: unitOwnerships.ownerId,
      shareBp: unitOwnerships.shareBp,
      lang: owners.preferredLang,
    })
    .from(unitOwnerships)
    .innerJoin(owners, eq(owners.id, unitOwnerships.ownerId))
    .where(
      and(
        eq(unitOwnerships.unitId, unitId),
        isNull(unitOwnerships.toDate),
        inArray(owners.status, ['active', 'invited']),
      ),
    );
}

function share(amountFils: number, bp: number): number {
  return Number((BigInt(amountFils) * BigInt(bp)) / 10_000n);
}
