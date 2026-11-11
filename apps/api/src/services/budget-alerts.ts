/**
 * The budget push: when a building's posted expenses reach 80 % or 100 % of a budget line, every
 * current owner of the building hears about it once per line, threshold and year. The check runs
 * after staff expense writes (see routes/staff.ts) and looks at every budget of this year and
 * last year, so a posting, a bulk post, a correction or showing a hidden expense all count, and
 * a budget set after the money was already spent alerts on the next posting.
 *
 * Owners are told what they can see: the figures count only expenses visible to owners, the same
 * figures as the budget card in the app. Only the highest threshold reached is sent, and an owner
 * already told a line was used up is not told later that it is at 80 % (after a void). Delivery,
 * dedupe and retries are the shared ones in notifications.ts.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  budgetAlertKeyDate,
  dedupeKey,
  thresholdReached,
  type BudgetThreshold,
} from '@vamar/shared';
import { cronDb, type Dbx } from '../db.js';
import type { Bindings } from '../env.js';
import { log } from '../util/log.js';
import { today } from '../util/today.js';
import { budgetReport } from './budgets.js';
import { deliver, type DeliveryReport, type PendingNotification } from './notifications.js';

const { budgets, notificationLog, owners, unitOwnerships, units } = schema;

/** What one check found and sent: lines at a threshold, and the push outcome. */
export interface BudgetAlertRun extends DeliveryReport {
  lines: number;
}

export async function queueBudgetAlerts(env: Bindings): Promise<BudgetAlertRun> {
  const { db, close } = cronDb(env);
  try {
    return await checkBudgetAlerts(env, db);
  } catch (e) {
    log('error', 'push.budget_threshold_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { lines: 0, sent: 0, skipped: 0, failed: 0 };
  } finally {
    await close();
  }
}

async function checkBudgetAlerts(env: Bindings, db: Dbx): Promise<BudgetAlertRun> {
  const date = today(env);
  const year = Number(date.slice(0, 4));
  // Last year too: an invoice dated in December is often posted in January.
  const years = [year - 1, year];
  const any = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(inArray(budgets.year, years))
    .limit(1);
  if (any.length === 0) return { lines: 0, sent: 0, skipped: 0, failed: 0 };

  interface Hit {
    year: number;
    threshold: BudgetThreshold;
    budgetId: string;
    buildingId: string;
    building: { ar: string; en: string };
    category: { ar: string; en: string } | null;
    actualFils: number;
    budgetFils: number;
  }
  const hits: Hit[] = [];
  for (const y of years) {
    const report = await budgetReport(db, { year: y, today: date, ownerVisibleOnly: true });
    for (const b of report.buildings)
      for (const l of b.lines) {
        const threshold = thresholdReached(l.actualFils, l.budgetFils);
        if (threshold === null) continue;
        hits.push({
          year: y,
          threshold,
          budgetId: l.budgetId,
          buildingId: b.buildingId,
          building: { ar: b.nameAr, en: b.nameEn },
          category: l.nameAr !== null && l.nameEn !== null ? { ar: l.nameAr, en: l.nameEn } : null,
          actualFils: l.actualFils,
          budgetFils: l.budgetFils,
        });
      }
  }
  if (hits.length === 0) return { lines: 0, sent: 0, skipped: 0, failed: 0 };

  const holders = await db
    .selectDistinct({
      buildingId: units.buildingId,
      ownerId: unitOwnerships.ownerId,
      lang: owners.preferredLang,
    })
    .from(unitOwnerships)
    .innerJoin(units, eq(units.id, unitOwnerships.unitId))
    .innerJoin(owners, eq(owners.id, unitOwnerships.ownerId))
    .where(
      and(
        isNull(unitOwnerships.toDate),
        inArray(units.buildingId, [...new Set(hits.map((h) => h.buildingId))]),
      ),
    );

  const items: { p: PendingNotification; usedUpKey: string | null }[] = [];
  for (const h of hits)
    for (const o of holders.filter((x) => x.buildingId === h.buildingId)) {
      const lang = o.lang;
      items.push({
        p: {
          ownerId: o.ownerId,
          type: 'budget_threshold',
          entityId: h.budgetId,
          date: budgetAlertKeyDate(h.year, h.threshold),
          params: {
            type: 'budget_threshold',
            threshold: h.threshold,
            year: h.year,
            buildingName: h.building[lang],
            categoryName: h.category ? h.category[lang] : null,
            actualFils: h.actualFils,
            budgetFils: h.budgetFils,
          },
        },
        usedUpKey:
          h.threshold === 80
            ? dedupeKey('budget_threshold', o.ownerId, h.budgetId, budgetAlertKeyDate(h.year, 100))
            : null,
      });
    }

  // An owner already told a line was used up is not told it is at 80 % again.
  const usedUpKeys = items.flatMap((i) => (i.usedUpKey ? [i.usedUpKey] : []));
  const told = new Set(
    usedUpKeys.length === 0
      ? []
      : (
          await db
            .select({ key: notificationLog.dedupeKey })
            .from(notificationLog)
            .where(
              and(
                inArray(notificationLog.dedupeKey, usedUpKeys),
                sql`${notificationLog.result} not like 'failed:%'`,
              ),
            )
        ).map((r) => r.key),
  );
  const toSend = items.filter((i) => !i.usedUpKey || !told.has(i.usedUpKey)).map((i) => i.p);
  const report = await deliver(env, db, toSend);
  if (report.sent > 0) log('info', 'push.budget_threshold', { sent: report.sent });
  return { lines: hits.length, ...report };
}
