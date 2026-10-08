/**
 * Push notifications through the Expo push API. Every send is recorded in notification_log with
 * a unique dedupe key, so re-running the cron (or a double trigger) cannot send twice.
 * On DeviceNotRegistered the device's token is revoked.
 */
import { and, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  chunk,
  dedupeKey,
  EXPO_PUSH_BATCH_SIZE,
  notificationCopy,
  todayInDubai,
  type DeviceInfo,
  type NotificationParams,
  type NotificationType,
  type PlainDate,
} from '@vamar/shared';
import type { Db, Dbx } from '../db.js';
import { cronDb } from '../db.js';
import type { Bindings } from '../env.js';
import { log } from '../util/log.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

/** Deliver a batch: claims the dedupe keys first, then pushes to every active device. */
export async function deliver(
  env: Bindings,
  db: Dbx,
  pending: PendingNotification[],
): Promise<{ sent: number; skipped: number }> {
  if (pending.length === 0) return { sent: 0, skipped: 0 };
  let sent = 0;
  let skipped = 0;

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

  const messages: { msg: ExpoMessage; deviceRowId: string }[] = [];
  for (const p of pending) {
    const owner = owners.find((o) => o.id === p.ownerId);
    if (!owner || owner.status === 'disabled') {
      skipped += 1;
      continue;
    }
    const key = dedupeKey(p.type, p.entityId, p.date);
    // Claim the key; a conflict means it was already sent.
    const claimed = await db
      .insert(schema.notificationLog)
      .values({
        ownerId: p.ownerId,
        type: p.type,
        entityId: p.entityId,
        dedupeKey: key,
        result: 'queued',
      })
      .onConflictDoNothing({ target: schema.notificationLog.dedupeKey })
      .returning({ id: schema.notificationLog.id });
    if (claimed.length === 0) {
      skipped += 1;
      continue;
    }
    const copy = notificationCopy(p.params, owner.preferredLang);
    const targets = devices.filter(
      (d) => d.ownerId === p.ownerId && d.deviceId !== p.excludeDeviceId && d.pushToken,
    );
    for (const d of targets) {
      if (!d.pushToken) continue;
      messages.push({
        msg: {
          to: d.pushToken,
          title: copy.title,
          body: copy.body,
          sound: 'default',
          data: { type: p.type, entityId: p.entityId },
        },
        deviceRowId: d.id,
      });
    }
    if (targets.length === 0) {
      await db
        .update(schema.notificationLog)
        .set({ result: 'no_device' })
        .where(eq(schema.notificationLog.dedupeKey, key));
    }
  }

  for (const batch of chunk(messages, EXPO_PUSH_BATCH_SIZE)) {
    const tickets = await sendExpoBatch(
      env,
      batch.map((b) => b.msg),
    );
    for (let i = 0; i < batch.length; i++) {
      const ticket = tickets[i];
      const item = batch[i];
      if (!item) continue;
      if (ticket?.status === 'ok') sent += 1;
      else if (ticket?.details?.error === 'DeviceNotRegistered') {
        await db
          .update(schema.devices)
          .set({ pushToken: null })
          .where(eq(schema.devices.id, item.deviceRowId));
        log('info', 'push.device_not_registered', { deviceRowId: item.deviceRowId });
      } else {
        log('warn', 'push.ticket_error', {
          error: ticket?.details?.error ?? ticket?.message ?? 'unknown',
        });
      }
    }
  }
  return { sent, skipped };
}

async function sendExpoBatch(env: Bindings, messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  if (messages.length === 0) return [];
  if (env.APP_ENV === 'test') return messages.map(() => ({ status: 'ok' as const, id: 'test' }));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (env.EXPO_ACCESS_TOKEN) headers['authorization'] = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      log('error', 'push.http_error', { status: res.status });
      return messages.map(() => ({ status: 'error' as const, message: `HTTP ${res.status}` }));
    }
    const json: { data?: ExpoTicket[] } = await res.json();
    return json.data ?? [];
  } catch (e) {
    log('error', 'push.network_error', { error: e instanceof Error ? e.message : String(e) });
    return messages.map(() => ({ status: 'error' as const, message: 'network' }));
  }
}

/** Fire-and-forget from a request: bounce alert to every current owner of the cheque's unit. */
export async function queueBounceAlert(env: Bindings, chequeId: string): Promise<void> {
  const { db, close } = cronDb(env);
  try {
    const [row] = await db
      .select({
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
      .where(eq(schema.cheques.id, chequeId));
    if (typeof row?.amountFils !== 'number') return;
    const ownersOfUnit = await db
      .select({
        ownerId: schema.unitOwnerships.ownerId,
        shareBp: schema.unitOwnerships.shareBp,
        lang: schema.owners.preferredLang,
      })
      .from(schema.unitOwnerships)
      .innerJoin(schema.owners, eq(schema.owners.id, schema.unitOwnerships.ownerId))
      .where(
        and(eq(schema.unitOwnerships.unitId, row.unitId), isNull(schema.unitOwnerships.toDate)),
      );
    const date = env.TEST_TODAY ? (env.TEST_TODAY as PlainDate) : todayInDubai();
    await deliver(
      env,
      db,
      ownersOfUnit.map((o) => ({
        ownerId: o.ownerId,
        type: 'cheque_bounced',
        entityId: chequeId,
        date,
        params: {
          type: 'cheque_bounced',
          amountFils: Number((BigInt(row.amountFils ?? 0) * BigInt(o.shareBp)) / 10_000n),
          unitLabel:
            o.lang === 'ar'
              ? `${row.buildingNameAr} ${row.unitNo}`
              : `${row.buildingNameEn} ${row.unitNo}`,
        },
      })),
    );
  } catch (e) {
    log('error', 'push.bounce_failed', { error: e instanceof Error ? e.message : String(e) });
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
    const label = device.model || (device.platform === 'ios' ? 'iPhone' : 'Android');
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

export type { Db };
