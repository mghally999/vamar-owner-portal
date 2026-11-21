/**
 * Push notifications through the Expo push API.
 *
 * Every notification is recorded in notification_log under a unique dedupe key, in two phases:
 * the key is claimed (`queued`) before the send, and the row is updated with the outcome after it
 * (`ok`, `no_device`, `error:<code>` or `failed:<reason>`). Claims are atomic, so two runs never
 * send the same row.
 *
 * - `failed:` is a transport problem (Expo down, refused with 429/5xx, network). The row keeps what
 *   it needs to be sent again (`payload`) and is retried with backoff (PUSH_RETRY) by the follow-up
 *   pass, up to a cap and only within a day of the first attempt. The daily job's own types are
 *   also claimed again when it regenerates them.
 * - A timeout is not retried (`error:timeout`): Expo may have accepted the request, and a missed
 *   push is better than the same push twice. The Expo call itself is never repeated after one.
 * - `error:` is a permanent ticket error and is not retried. On DeviceNotRegistered the device's
 *   token is cleared (only if it is still the token the push went to).
 * - Accepted tickets are kept in push_tickets; the follow-up pass reads their receipts (Expo keeps
 *   them a day), marks the notification `undelivered:<code>` when every receipt is an error, and
 *   clears tokens on DeviceNotRegistered.
 *
 * The follow-up pass (pushFollowUp) runs after every event delivery, while the database is awake
 * anyway, and in the daily job; it never wakes the database on its own.
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
import { cronDb, rowsOf } from '../db.js';
import type { Bindings } from '../env.js';
import { log } from '../util/log.js';
import { fetchWithRetry, OutboundError } from '../util/outbound.js';
import { expenseOwnerIds } from './expenses.js';
import { ownerVisibleCost, workOrderOwnerIds } from './work-orders.js';

const { notificationLog, pushTickets, devices } = schema;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const EXPO_TIMEOUT_MS = 10_000;
/** Expo accepts up to 1,000 receipt ids per call. */
const RECEIPT_BATCH = 500;

/** Retries of `failed:` sends: attempts in all, the wait after each failure, and the window. */
export const PUSH_RETRY = {
  maxAttempts: 4,
  backoffMs: [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000],
  windowMs: 24 * 60 * 60_000,
  /** Rows taken per follow-up pass. */
  batch: 50,
} as const;

/** Receipts are read once a ticket is this old (Expo's advice) and dropped after a day. */
export const RECEIPTS = { minAgeMs: 15 * 60_000, maxAgeMs: 24 * 60 * 60_000 } as const;

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
  /** Transport failures; retried later (PUSH_RETRY). */
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

type BatchOutcome = { tickets: ExpoTicket[] } | { transportError: string; retryable: boolean };

/** What a retry needs that the row does not already hold. */
interface PushPayload {
  params: NotificationParams;
  excludeDeviceId?: string | undefined;
}

/** A claimed notification_log row, ready to send. */
interface Claim {
  id: string;
  ownerId: string;
  type: NotificationType;
  entityId: string;
  payload: PushPayload;
  attempts: number;
}

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

/**
 * Deliver a batch: claims the dedupe keys first (one statement), then pushes to every active
 * device. A key already handled is skipped; one whose earlier attempt failed in transport is
 * claimed again while under the attempt cap.
 */
export async function deliver(
  env: Bindings,
  db: Dbx,
  pending: PendingNotification[],
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, skipped: 0, failed: 0 };
  if (pending.length === 0) return report;

  const ownerIds = [...new Set(pending.map((p) => p.ownerId))];
  const owners = await db
    .select({ id: schema.owners.id, status: schema.owners.status })
    .from(schema.owners)
    .where(inArray(schema.owners.id, ownerIds));
  const live = new Set(owners.filter((o) => o.status !== 'disabled').map((o) => o.id));

  const byKey = new Map<string, PendingNotification>();
  for (const p of pending) {
    if (!live.has(p.ownerId)) {
      report.skipped += 1;
      continue;
    }
    const key = dedupeKey(p.type, p.ownerId, p.entityId, p.date);
    if (byKey.has(key)) report.skipped += 1;
    else byKey.set(key, p);
  }
  if (byKey.size === 0) return report;

  const claimed = await db
    .insert(notificationLog)
    .values(
      [...byKey].map(([key, p]) => ({
        ownerId: p.ownerId,
        type: p.type,
        entityId: p.entityId,
        dedupeKey: key,
        result: 'queued',
        payload: { params: p.params, excludeDeviceId: p.excludeDeviceId } satisfies PushPayload,
      })),
    )
    .onConflictDoUpdate({
      target: notificationLog.dedupeKey,
      set: {
        result: 'queued',
        sentAt: sql`now()`,
        attempts: sql`${notificationLog.attempts} + 1`,
        nextAttemptAt: null,
        payload: sql`excluded.payload`,
      },
      setWhere: sql`${notificationLog.result} like 'failed:%' and ${notificationLog.attempts} < ${PUSH_RETRY.maxAttempts}`,
    })
    .returning({
      id: notificationLog.id,
      key: notificationLog.dedupeKey,
      attempts: notificationLog.attempts,
    });
  report.skipped += byKey.size - claimed.length;

  const claims: Claim[] = claimed.flatMap((c) => {
    const p = byKey.get(c.key);
    if (!p) return [];
    return {
      id: c.id,
      ownerId: p.ownerId,
      type: p.type,
      entityId: p.entityId,
      attempts: c.attempts,
      payload: { params: p.params, excludeDeviceId: p.excludeDeviceId },
    };
  });
  const sent = await sendClaims(env, db, claims);
  report.sent += sent.sent;
  report.skipped += sent.skipped;
  report.failed += sent.failed;
  return report;
}

/** Push the claimed rows to the owners' devices and record each outcome (a fixed number of statements). */
async function sendClaims(env: Bindings, db: Dbx, claims: Claim[]): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, skipped: 0, failed: 0 };
  if (claims.length === 0) return report;
  const ownerIds = [...new Set(claims.map((c) => c.ownerId))];
  const [owners, targets] = await Promise.all([
    db
      .select({
        id: schema.owners.id,
        preferredLang: schema.owners.preferredLang,
        status: schema.owners.status,
      })
      .from(schema.owners)
      .where(inArray(schema.owners.id, ownerIds)),
    db
      .select({
        id: devices.id,
        ownerId: devices.ownerId,
        deviceId: devices.deviceId,
        pushToken: devices.pushToken,
      })
      .from(devices)
      .where(
        and(
          inArray(devices.ownerId, ownerIds),
          isNull(devices.revokedAt),
          isNotNull(devices.pushToken),
        ),
      ),
  ]);

  interface Item {
    claim: Claim;
    deviceRowId: string;
    token: string;
    msg: ExpoMessage;
  }
  const outcome = new Map<string, { ok: number; error: string | null }>();
  const items: Item[] = [];
  for (const c of claims) {
    const owner = owners.find((o) => o.id === c.ownerId);
    outcome.set(c.id, { ok: 0, error: null });
    if (!owner || owner.status === 'disabled') {
      outcome.set(c.id, { ok: 0, error: 'error:owner_disabled' });
      continue;
    }
    const copy = notificationCopy(c.payload.params, owner.preferredLang);
    for (const d of targets) {
      if (d.ownerId !== c.ownerId || d.deviceId === c.payload.excludeDeviceId || !d.pushToken)
        continue;
      items.push({
        claim: c,
        deviceRowId: d.id,
        token: d.pushToken,
        msg: {
          to: d.pushToken,
          title: copy.title,
          body: copy.body,
          sound: 'default',
          data: pushData({ type: c.type, entityId: c.entityId, params: c.payload.params }),
        },
      });
    }
  }

  const tickets: { id: string; notificationId: string; deviceId: string; pushToken: string }[] = [];
  const unregistered: { deviceRowId: string; token: string }[] = [];
  for (const batch of chunk(items, EXPO_PUSH_BATCH_SIZE)) {
    const res = await sendExpoBatch(
      env,
      batch.map((b) => b.msg),
    );
    if ('transportError' in res) {
      const code = `${res.retryable ? 'failed' : 'error'}:${res.transportError}`;
      for (const item of batch) {
        const o = outcome.get(item.claim.id);
        if (o && !o.error?.startsWith('error:')) o.error = code;
      }
      continue;
    }
    batch.forEach((item, i) => {
      const ticket = res.tickets[i];
      const o = outcome.get(item.claim.id);
      if (!o) return;
      if (ticket?.status === 'ok') {
        o.ok += 1;
        if (ticket.id)
          tickets.push({
            id: ticket.id,
            notificationId: item.claim.id,
            deviceId: item.deviceRowId,
            pushToken: item.token,
          });
        return;
      }
      const code = ticket?.details?.error ?? ticket?.message ?? 'unknown';
      if (code === 'DeviceNotRegistered') {
        unregistered.push({ deviceRowId: item.deviceRowId, token: item.token });
        log('info', 'push.device_not_registered', { deviceRowId: item.deviceRowId });
      } else {
        log('warn', 'push.ticket_error', { error: code });
      }
      o.error = `error:${code}`.slice(0, 80);
    });
  }

  const now = Date.now();
  const results = claims.map((c) => {
    const o = outcome.get(c.id) ?? { ok: 0, error: null };
    const hasDevice = items.some((i) => i.claim.id === c.id);
    let result: string;
    if (o.ok > 0) result = 'ok';
    else if (o.error) result = o.error;
    else result = hasDevice ? 'error:unknown' : 'no_device';
    const failed = result.startsWith('failed:');
    const backoff = PUSH_RETRY.backoffMs[c.attempts - 1];
    const retryAt =
      failed && c.attempts < PUSH_RETRY.maxAttempts && backoff !== undefined
        ? new Date(now + backoff).toISOString()
        : null;
    if (result === 'ok') report.sent += 1;
    else if (failed) report.failed += 1;
    else report.skipped += 1;
    return { id: c.id, result, retryAt };
  });

  await Promise.all([
    recordResults(db, results),
    tickets.length ? db.insert(pushTickets).values(tickets).onConflictDoNothing() : null,
    clearTokens(db, unregistered),
  ]);
  if (report.failed > 0) log('warn', 'push.transport_failed', { failed: report.failed });
  return report;
}

/**
 * Every outcome in one statement. A failed row keeps its payload and gets its next attempt time;
 * a final one drops the payload (the push text is in the app, not needed in the log).
 */
async function recordResults(
  db: Dbx,
  results: { id: string; result: string; retryAt: string | null }[],
): Promise<void> {
  if (results.length === 0) return;
  const values = sql.join(
    results.map((r) => sql`(${r.id}::uuid, ${r.result}::text, ${r.retryAt}::timestamptz)`),
    sql`, `,
  );
  await db.execute(sql`
    update ${notificationLog} as n
    set result = v.result,
        next_attempt_at = v.retry_at,
        payload = case when v.result like 'failed:%' then n.payload else null end
    from (values ${values}) as v(id, result, retry_at)
    where n.id = v.id`);
}

/** DeviceNotRegistered: clear each token, unless the device has registered a new one since. */
async function clearTokens(db: Dbx, list: { deviceRowId: string; token: string }[]): Promise<void> {
  if (list.length === 0) return;
  const values = sql.join(
    list.map((d) => sql`(${d.deviceRowId}::uuid, ${d.token}::text)`),
    sql`, `,
  );
  await db.execute(sql`
    update ${devices} as d set push_token = null
    from (values ${values}) as v(id, token)
    where d.id = v.id and d.push_token = v.token`);
}

/**
 * Failed sends that are due again: claimed atomically (a row another pass took is not returned,
 * so nothing is sent twice) and sent like a new batch.
 */
export async function retryFailedPushes(env: Bindings, db: Dbx): Promise<DeliveryReport> {
  const claimed = rowsOf<{
    id: string;
    owner_id: string;
    type: NotificationType;
    entity_id: string;
    payload: PushPayload | string;
    /** smallint: a number from pg and PGlite, text from some drivers. */
    attempts: number | string;
  }>(
    await db.execute(sql`
      update ${notificationLog} as n
      set result = 'queued', sent_at = now(), attempts = n.attempts + 1, next_attempt_at = null
      where n.id in (
        select id from ${notificationLog}
        where result like 'failed:%' and next_attempt_at <= now() and payload is not null
          and attempts < ${PUSH_RETRY.maxAttempts}
          and created_at > now() - make_interval(secs => ${PUSH_RETRY.windowMs / 1000})
        order by next_attempt_at
        limit ${PUSH_RETRY.batch}
        for update skip locked)
        and n.result like 'failed:%'
      returning n.id, n.owner_id, n.type, n.entity_id, n.payload, n.attempts`),
  );
  if (claimed.length === 0) return { sent: 0, skipped: 0, failed: 0 };
  const report = await sendClaims(
    env,
    db,
    claimed.map((r) => ({
      id: r.id,
      ownerId: r.owner_id,
      type: r.type,
      entityId: r.entity_id,
      attempts: Number(r.attempts),
      payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as PushPayload,
    })),
  );
  log('info', 'push.retried', { ...report });
  return report;
}

interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Read the receipts of accepted tickets at least `minAgeMs` old. An `ok` receipt is the end of it;
 * an error is logged, clears the token on DeviceNotRegistered, and marks the notification
 * `undelivered:<code>` when none of its pushes got through. Tickets older than a day have no
 * receipt left and are dropped. Receipts Expo has not produced yet stay for the next pass.
 */
export async function checkPushReceipts(
  env: Bindings,
  db: Dbx,
  minAgeMs: number = RECEIPTS.minAgeMs,
): Promise<{ checked: number; errors: number }> {
  const now = Date.now();
  await db
    .delete(pushTickets)
    .where(
      sql`${pushTickets.createdAt} < ${new Date(now - RECEIPTS.maxAgeMs).toISOString()}::timestamptz`,
    );
  const due = await db
    .select()
    .from(pushTickets)
    .where(sql`${pushTickets.createdAt} <= ${new Date(now - minAgeMs).toISOString()}::timestamptz`)
    .orderBy(pushTickets.createdAt)
    .limit(RECEIPT_BATCH * 2);
  if (due.length === 0) return { checked: 0, errors: 0 };

  const done: string[] = [];
  const unregistered: { deviceRowId: string; token: string }[] = [];
  const perNotification = new Map<string, { ok: number; error: string | null }>();
  for (const batch of chunk(due, RECEIPT_BATCH)) {
    const receipts = await fetchReceipts(
      env,
      batch.map((t) => t.id),
    );
    if (!receipts) break;
    for (const t of batch) {
      const r = receipts[t.id];
      if (!r) continue;
      done.push(t.id);
      const n = perNotification.get(t.notificationId) ?? { ok: 0, error: null };
      perNotification.set(t.notificationId, n);
      if (r.status === 'ok') {
        n.ok += 1;
        continue;
      }
      const code = r.details?.error ?? r.message ?? 'unknown';
      n.error = `undelivered:${code}`.slice(0, 80);
      if (code === 'DeviceNotRegistered')
        unregistered.push({ deviceRowId: t.deviceId, token: t.pushToken });
      log('warn', 'push.receipt_error', { error: code });
    }
  }
  const failedIds = [...perNotification].flatMap(([id, n]) =>
    n.ok === 0 && n.error ? [{ id, result: n.error }] : [],
  );
  await Promise.all([
    done.length ? db.delete(pushTickets).where(inArray(pushTickets.id, done)) : null,
    clearTokens(db, unregistered),
  ]);
  if (failedIds.length) {
    // Only when every ticket of the notification has been answered by an error receipt.
    const values = sql.join(
      failedIds.map((f) => sql`(${f.id}::uuid, ${f.result}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      update ${notificationLog} as n set result = v.result
      from (values ${values}) as v(id, result)
      where n.id = v.id and n.result = 'ok'
        and not exists (select 1 from ${pushTickets} t where t.notification_id = n.id)`);
  }
  return { checked: done.length, errors: failedIds.length };
}

/**
 * Retries that are due and receipts that are ready. Runs where the database is already awake:
 * after an event delivery and in the daily job. Failures are logged, never thrown.
 */
export async function pushFollowUp(env: Bindings, db: Dbx): Promise<void> {
  try {
    await retryFailedPushes(env, db);
    await checkPushReceipts(env, db);
  } catch (e) {
    log('error', 'push.follow_up_failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Event pushes: deliver, then the follow-up pass while the database is awake. */
export async function deliverEvent(
  env: Bindings,
  db: Dbx,
  pending: PendingNotification[],
): Promise<DeliveryReport> {
  if (pending.length === 0) return { sent: 0, skipped: 0, failed: 0 };
  const report = await deliver(env, db, pending);
  await pushFollowUp(env, db);
  return report;
}

async function sendExpoBatch(env: Bindings, messages: ExpoMessage[]): Promise<BatchOutcome> {
  if (messages.length === 0) return { tickets: [] };
  if (env.APP_ENV === 'test' && env.TEST_DB) {
    // The test harness never talks to Expo; TEST_PUSH selects the outcome to exercise.
    if (env.TEST_PUSH === 'fail') return { transportError: 'test', retryable: true };
    if (env.TEST_PUSH === 'timeout') return { transportError: 'timeout', retryable: false };
    return {
      tickets: messages.map(() => ({ status: 'ok' as const, id: `test-${crypto.randomUUID()}` })),
    };
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
      { timeoutMs: EXPO_TIMEOUT_MS, retries: 2, retryOnTimeout: false, label: 'expo push' },
    );
    if (!res.ok) {
      log('error', 'push.http_error', { status: res.status });
      // 429 and 5xx: Expo did not take the batch, try later. Other 4xx: the request is wrong.
      return {
        transportError: `http_${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    const json: { data?: ExpoTicket[] } = await res.json();
    return { tickets: json.data ?? [] };
  } catch (e) {
    const kind = e instanceof OutboundError ? e.kind : 'network';
    log('error', 'push.transport_error', {
      kind,
      error: e instanceof Error ? e.message : String(e),
    });
    return { transportError: kind, retryable: kind !== 'timeout' };
  }
}

async function fetchReceipts(
  env: Bindings,
  ids: string[],
): Promise<Record<string, ExpoReceipt> | null> {
  if (env.APP_ENV === 'test' && env.TEST_DB) {
    const outcome = env.TEST_PUSH_RECEIPT ?? 'ok';
    if (outcome === 'pending') return {};
    return Object.fromEntries(
      ids.map((id) => [
        id,
        outcome === 'ok'
          ? { status: 'ok' as const }
          : { status: 'error' as const, details: { error: outcome } },
      ]),
    );
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (env.EXPO_ACCESS_TOKEN) headers['authorization'] = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  try {
    // Reading receipts is safe to repeat, so timeouts are retried here.
    const res = await fetchWithRetry(
      EXPO_RECEIPTS_URL,
      { method: 'POST', headers, body: JSON.stringify({ ids }) },
      { timeoutMs: EXPO_TIMEOUT_MS, retries: 2, label: 'expo receipts' },
    );
    if (!res.ok) {
      log('error', 'push.receipts_http_error', { status: res.status });
      return null;
    }
    const json: { data?: Record<string, ExpoReceipt> } = await res.json();
    return json.data ?? {};
  } catch (e) {
    log('error', 'push.receipts_failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
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
    await deliverEvent(env, db, pending);
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
    return await deliverEvent(
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
    await deliverEvent(env, db, [
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
