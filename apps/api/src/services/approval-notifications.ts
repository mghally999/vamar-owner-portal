/**
 * The "approval needed" push: one per request, to the owner it asks, in their language, with
 * their share. The notification's entity is the request itself, so a tap opens it in the app and
 * a request asked again (higher estimate) is a new push. Delivery, dedupe and retries are the
 * shared ones in notifications.ts.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { cronDb } from '../db.js';
import type { Bindings } from '../env.js';
import { log } from '../util/log.js';
import { today } from '../util/today.js';
import { deliver, type PendingNotification } from './notifications.js';

const { repairApprovals, workOrders, expenses, buildings, units, owners } = schema;

export async function queueApprovalRequests(env: Bindings, approvalIds: string[]): Promise<void> {
  if (approvalIds.length === 0) return;
  const { db, close } = cronDb(env);
  try {
    const rows = await db
      .select({
        id: repairApprovals.id,
        ownerId: repairApprovals.ownerId,
        lang: owners.preferredLang,
        amountFils: repairApprovals.amountFils,
        shareFils: repairApprovals.shareFils,
        woTitleAr: workOrders.titleAr,
        woTitleEn: workOrders.titleEn,
        xReasonAr: expenses.reasonAr,
        xReasonEn: expenses.reasonEn,
        bAr: buildings.nameAr,
        bEn: buildings.nameEn,
        unitNo: units.unitNo,
      })
      .from(repairApprovals)
      .innerJoin(owners, eq(owners.id, repairApprovals.ownerId))
      .leftJoin(workOrders, eq(workOrders.id, repairApprovals.workOrderId))
      .leftJoin(expenses, eq(expenses.id, repairApprovals.expenseId))
      .innerJoin(
        buildings,
        sql`${buildings.id} = coalesce(${workOrders.buildingId}, ${expenses.buildingId})`,
      )
      .leftJoin(units, sql`${units.id} = coalesce(${workOrders.unitId}, ${expenses.unitId})`)
      .where(inArray(repairApprovals.id, approvalIds));
    const date = today(env);
    const pending: PendingNotification[] = rows.map((r) => {
      const ar = r.lang === 'ar';
      const title = (ar ? (r.woTitleAr ?? r.xReasonAr) : (r.woTitleEn ?? r.xReasonEn)) ?? '';
      return {
        ownerId: r.ownerId,
        type: 'repair_approval_needed',
        entityId: r.id,
        date,
        params: {
          type: 'repair_approval_needed',
          title,
          placeLabel: `${ar ? r.bAr : r.bEn}${r.unitNo ? ` ${r.unitNo}` : ''}`,
          totalFils: r.amountFils,
          shareFils: r.shareFils,
        },
      };
    });
    await deliver(env, db, pending);
  } catch (e) {
    log('error', 'push.approval_request_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await close();
  }
}
