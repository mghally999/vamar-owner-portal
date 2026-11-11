/**
 * Push notifications through the Expo push API.
 *
 * Every notification is recorded in notification_log under a unique dedupe key, in two phases:
 * the key is claimed (`queued`) before the send, and the row is updated with the outcome after it
 * (`ok`, `no_device`, `error:<code>` or `failed:<reason>`). A `failed:` row is a transport problem
 * (Expo down, timeout) and is claimed again by the next run, so nothing is lost; an `error:` row
 * is a permanent ticket error and is not retried. On DeviceNotRegistered the device's token is
 * cleared.
 */
import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  chunk,
  dedupeKey,
  EXPO_PUSH_BATCH_SIZE,
  firstDayOfMonth,
  lastDayOfMonth,
  notificationCopy,
  ownerShareAmount,
  todayInDubai,
  type DeviceInfo,
  type NotificationParams,
  type NotificationType,
  type PlainDate,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { cronDb } from '../db.js';
import type { Bindings } from '../env.js';
import { log } from '../util/log.js';
import { fetchWithRetry, OutboundError } from '../util/outbound.js';
import { expenseOwnerIds } from './expenses.js';
import { ownerVisibleCost, workOrderOwnerIds } from './work-orders.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TIMEOUT_MS = 10_000;

export interface PendingNotification {
  ownerId: string;
  type: NotificationType;
  entityId: string;
  params: NotificationParams;
  /** Business date used in the dedupe key. */
  date: PlainDate;
  /** Device to exclude (the one that just logged in). */
  excludeDeviceId?: string | undefined;
}

export interface DeliveryReport {
  /** Notifications with at least one device that accepted the push. */
  sent: number;
  /** Already delivered earlier, owner disabled, or no device. */
  skipped: number;
  /** Transport failures; claimed again by the next run. */
  failed: number;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: Record<string, string>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

type BatchOutcome = { tickets: ExpoTicket[] } | { transportError: string };

/**
 * What the app reads when the owner taps a push: the type and the record it is about. The monthly
 * summary also names the month (`from`, `to`), so a tap days or weeks later still opens that
 * month's statement rather than whatever "last month" is by then. Apps that predate the period
 * ignore the extra keys.
 */
export function pushData(
  p: Pick<PendingNotification, 'type' | 'entityId' | 'params'>,
): Record<string, string> {
  const data = { type: p.type, entityId: p.entityId };
  if (p.params.type !== 'monthly_summary') return data;
  return {
    ...data,
    from: firstDayOfMonth(p.params.month),
    to: lastDayOfMonth(p.params.month),
  };
}

/** Deliver a batch: claims the dedupe keys first, then pushes to every active device. */
export async function deliver(
  env: Bindings,
  db: Dbx,
  pending: PendingNotification[],
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, skipped: 0, failed: 0 };
  if (pending.length === 0) return report;

  const ownerIds = [...new Set(pending.map((p) => p.ownerId))];
  const owners = await db
    .select({
      id: schema.owners.id,
      preferredLang: schema.owners.preferredLang,
      status: schema.owners.status,
    })
    .from(schema.owners)
    .where(inArray(schema.owners.id, ownerIds));
  const devices = await db
    .select({
      id: schema.devices.id,
      ownerId: schema.devices.ownerId,
      deviceId: schema.devices.deviceId,
      pushToken: schema.devices.pushToken,
    })
    .from(schema.devices)
    .where(
      and(
        inArray(schema.devices.ownerId, ownerIds),
        isNull(schema.devices.revokedAt),
        isNotNull(schema.devices.pushToken),
      ),
    );

  interface Claim {
    key: string;
    messages: { msg: ExpoMessage; deviceRowId: string }[];
    okCount: number;
    lastError: string | null;
  }
  const claims: Claim[] = [];
  for (const p of pending) {
    const owner = owners.find((o) => o.id === p.ownerId);
    if (!owner || owner.status === 'disabled') {
      report.skipped += 1;
      continue;
    }
    const key = dedupeKey(p.type, p.ownerId, p.entityId, p.date);
    // Claim the key. A conflict means it was handled before, unless that attempt failed in
    // transport, in which case the row is claimed again.
    const claimed = await db
      .insert(schema.notificationLog)
      .values({
        ownerId: p.ownerId,
        type: p.type,
        entityId: p.entityId,
        dedupeKey: key,
        result: 'queued',
      })
      .onConflictDoUpdate({
        target: schema.notificationLog.dedupeKey,
        set: { result: 'queued', sentAt: new Date() },
        setWhere: sql`${schema.notificationLog.result} like 'failed:%'`,
      })
      .returning({ id: schema.notificationLog.id });
    if (claimed.length === 0) {
      report.skipped += 1;
      continue;
    }
    const copy = notificationCopy(p.params, owner.preferredLang);
    const targets = devices.filter(
      (d) => d.ownerId === p.ownerId && d.deviceId !== p.excludeDeviceId && d.pushToken,
    );
    if (targets.length === 0) {
      await setResult(db, key, 'no_device');
      report.skipped += 1;
      continue;
    }
    claims.push({
      key,
      okCount: 0,
      lastError: null,
      messages: targets.map((d) => ({
        deviceRowId: d.id,
        msg: {
          to: d.pushToken ?? '',
          title: copy.title,
          body: copy.body,
          sound: 'default',
          data: pushData(p),
        },
      })),
    });
  }

  const flat = claims.flatMap((c) => c.messages.map((m) => ({ ...m, claim: c })));
  for (const batch of chunk(flat, EXPO_PUSH_BATCH_SIZE)) {
    const outcome = await sendExpoBatch(
      env,
      batch.map((b) => b.msg),
    );
    if ('transportError' in outcome) {
      for (const item of batch) item.claim.lastError = `failed:${outcome.transportError}`;
      continue;
    }
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const ticket = outcome.tickets[i];
      if (!item) continue;
      if (ticket?.status === 'ok') {
        item.claim.okCount += 1;
        continue;
      }
      const code = ticket?.details?.error ?? ticket?.message ?? 'unknown';
      if (code === 'DeviceNotRegistered') {
        await db
          .update(schema.devices)
          .set({ pushToken: null })
          .where(eq(schema.devices.id, item.deviceRowId));
        log('info', 'push.device_not_registered', { deviceRowId: item.deviceRowId });
      } else {
        log('warn', 'push.ticket_error', { error: code });
      }
      item.claim.lastError = `error:${code}`.slice(0, 80);
    }
  }

  for (const c of claims) {
    if (c.okCount > 0) {
      await setResult(db, c.key, 'ok');
      report.sent += 1;
    } else if (c.lastError?.startsWith('failed:')) {
      await setResult(db, c.key, c.lastError);
      report.failed += 1;
    } else {
      await setResult(db, c.key, c.lastError ?? 'error:unknown');
      report.skipped += 1;
    }
  }
  if (report.failed > 0) log('warn', 'push.transport_failed', { failed: report.failed });
  return report;
}

async function setResult(db: Dbx, key: string, result: string): Promise<void> {
  await db
    .update(schema.notificationLog)
    .set({ result })
    .where(eq(schema.notificationLog.dedupeKey, key));
}

async function sendExpoBatch(env: Bindings, messages: ExpoMessage[]): Promise<BatchOutcome> {
  if (messages.length === 0) return { tickets: [] };
  if (env.APP_ENV === 'test' && env.TEST_DB) {
    // The test harness never talks to Expo; TEST_PUSH selects the outcome to exercise.
    if (env.TEST_PUSH === 'fail') return { transportError: 'test' };
    return { tickets: messages.map(() => ({ status: 'ok' as const, id: 'test' })) };
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (env.EXPO_ACCESS_TOKEN) headers['authorization'] = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  try {
    const res = await fetchWithRetry(
      EXPO_PUSH_URL,
      { method: 'POST', headers, body: JSON.stringify(messages) },
      { timeoutMs: EXPO_TIMEOUT_MS, retries: 2, label: 'expo push' },
    );
    if (!res.ok) {
      log('error', 'push.http_error', { status: res.status });
      return { transportError: `http_${res.status}` };
    }
    const json: { data?: ExpoTicket[] } = await res.json();
    return { tickets: json.data ?? [] };
  } catch (e) {
    const kind = e instanceof OutboundError ? e.kind : 'network';
    log('error', 'push.transport_error', {
      kind,
      error: e instanceof Error ? e.message : String(e),
    });
    return { transportError: kind };
  }
}

/** Bounce alerts to every current owner of each cheque's unit; one database handle for all. */
export async function queueBounceAlerts(env: Bindings, chequeIds: string[]): Promise<void> {
  if (chequeIds.length === 0) return;
  const { db, close } = cronDb(env);
  try {
    const rows = await db
      .select({
        chequeId: schema.cheques.id,
        unitId: schema.contracts.unitId,
        amountFils: schema.cheques.amountFils,
        unitNo: schema.units.unitNo,
        buildingNameEn: schema.buildings.nameEn,
        buildingNameAr: schema.buildings.nameAr,
      })
      .from(schema.cheques)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.cheques.contractId))
      .innerJoin(schema.units, eq(schema.units.id, schema.contracts.unitId))
      .innerJoin(schema.buildings, eq(schema.buildings.id, schema.units.buildingId))
      .where(inArray(schema.cheques.id, chequeIds));
    const unitIds = [...new Set(rows.map((r) => r.unitId))];
    if (unitIds.length === 0) return;
    const ownersOfUnits = await db
      .select({
        unitId: schema.unitOwnerships.unitId,
        ownerId: schema.unitOwnerships.ownerId,
        shareBp: schema.unitOwnerships.shareBp,
        lang: schema.owners.preferredLang,
      })
      .from(schema.unitOwnerships)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.unitOwnerships.ownerId))
      .where(
        and(inArray(schema.unitOwnerships.unitId, unitIds), isNull(schema.unitOwnerships.toDate)),
      );
    const date = env.TEST_TODAY ? (env.TEST_TODAY as PlainDate) : todayInDubai();
    const pending: PendingNotification[] = [];
    for (const row of rows) {
      if (typeof row.amountFils !== 'number') continue;
      for (const o of ownersOfUnits.filter((x) => x.unitId === row.unitId)) {
        pending.push({
          ownerId: o.ownerId,
          type: 'cheque_bounced',
          entityId: row.chequeId,
          date,
          params: {
            type: 'cheque_bounced',
            amountFils: ownerShareAmount(row.amountFils, o.shareBp),
            unitLabel:
              o.lang === 'ar'
                ? `${row.buildingNameAr} ${row.unitNo}`
                : `${row.buildingNameEn} ${row.unitNo}`,
          },
        });
      }
    }
    await deliver(env, db, pending);
  } catch (e) {
    log('error', 'push.bounce_failed', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    await close();
  }
}

/**
 * Fan an alert out to a set of owners with per-language parameters (unit labels and titles
 * differ by language). One database handle for the lookup and the delivery.
 */
export async function queueToOwners(
  env: Bindings,
  type: NotificationType,
  entityId: string,
  ownerIds: string[],
  paramsFor: (lang: 'ar' | 'en') => NotificationParams,
): Promise<DeliveryReport> {
  if (ownerIds.length === 0) return { sent: 0, skipped: 0, failed: 0 };
  const { db, close } = cronDb(env);
  try {
    const rows = await db
      .select({ id: schema.owners.id, lang: schema.owners.preferredLang })
      .from(schema.owners)
      .where(inArray(schema.owners.id, ownerIds));
    const date = env.TEST_TODAY ? (env.TEST_TODAY as PlainDate) : todayInDubai();
    return await deliver(
      env,
      db,
      rows.map((o) => ({ ownerId: o.id, type, entityId, date, params: paramsFor(o.lang) })),
    );
  } finally {
    await close();
  }
}

/** A work order marked done: the owners of its unit (or building) hear about it, with the cost. */
export async function queueWorkOrderDoneAlert(env: Bindings, workOrderId: string): Promise<void> {
  const { db, close } = cronDb(env);
  try {
    const [row] = await db
      .select({
        titleAr: schema.workOrders.titleAr,
        titleEn: schema.workOrders.titleEn,
        unitNo: schema.units.unitNo,
        bAr: schema.buildings.nameAr,
        bEn: schema.buildings.nameEn,
        costFils: schema.expenses.totalFils,
        expenseStatus: schema.expenses.status,
        expenseVisibleToOwner: schema.expenses.visibleToOwner,
      })
      .from(schema.workOrders)
      .innerJoin(schema.buildings, eq(schema.buildings.id, schema.workOrders.buildingId))
      .leftJoin(schema.units, eq(schema.units.id, schema.workOrders.unitId))
      .leftJoin(schema.expenses, eq(schema.expenses.id, schema.workOrders.expenseId))
      .where(eq(schema.workOrders.id, workOrderId));
    if (!row) return;
    const ownerIds = await workOrderOwnerIds(db, workOrderId);
    // The cost is told only when the paying expense is posted and visible to owners.
    const cost = ownerVisibleCost({
      status: row.expenseStatus,
      visibleToOwner: row.expenseVisibleToOwner,
      totalFils: row.costFils,
    });
    await queueToOwners(env, 'work_order_done', workOrderId, ownerIds, (lang) => ({
      type: 'work_order_done',
      title: lang === 'ar' ? row.titleAr : row.titleEn,
      unitLabel: `${lang === 'ar' ? row.bAr : row.bEn}${row.unitNo ? ` ${row.unitNo}` : ''}`,
      costFils: cost,
    }));
  } catch (e) {
    log('error', 'push.work_order_done_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await close();
  }
}

/** A large expense was posted: every owner with a share hears about it (their share is in the app). */
export async function queueLargeExpenseAlert(env: Bindings, expenseId: string): Promise<void> {
  const { db, close } = cronDb(env);
  try {
    const [row] = await db
      .select({
        reasonAr: schema.expenses.reasonAr,
        reasonEn: schema.expenses.reasonEn,
        totalFils: schema.expenses.totalFils,
        visibleToOwner: schema.expenses.visibleToOwner,
        unitNo: schema.units.unitNo,
        bAr: schema.buildings.nameAr,
        bEn: schema.buildings.nameEn,
      })
      .from(schema.expenses)
      .innerJoin(schema.buildings, eq(schema.buildings.id, schema.expenses.buildingId))
      .leftJoin(schema.units, eq(schema.units.id, schema.expenses.unitId))
      .where(eq(schema.expenses.id, expenseId));
    if (!row?.visibleToOwner) return;
    const ownerIds = await expenseOwnerIds(db, expenseId);
    await queueToOwners(env, 'large_expense', expenseId, ownerIds, (lang) => ({
      type: 'large_expense',
      reason: lang === 'ar' ? row.reasonAr : row.reasonEn,
      totalFils: row.totalFils,
      placeLabel: `${lang === 'ar' ? row.bAr : row.bEn}${row.unitNo ? ` ${row.unitNo}` : ''}`,
    }));
  } catch (e) {
    log('error', 'push.large_expense_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await close();
  }
}

/** New-device login alert to the owner's other devices. */
export async function queueNewDeviceAlert(
  env: Bindings,
  ownerId: string,
  device: DeviceInfo,
): Promise<void> {
  const { db, close } = cronDb(env);
  try {
    const date = env.TEST_TODAY ? (env.TEST_TODAY as PlainDate) : todayInDubai();
    const label =
      device.model ||
      (device.platform === 'ios' ? 'iPhone' : device.platform === 'web' ? 'Web' : 'Android');
    await deliver(env, db, [
      {
        ownerId,
        type: 'new_device_login',
        entityId: crypto.randomUUID(),
        date,
        excludeDeviceId: device.deviceId,
        params: { type: 'new_device_login', deviceLabel: label },
      },
    ]);
  } catch (e) {
    log('error', 'push.new_device_failed', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    await close();
  }
}
