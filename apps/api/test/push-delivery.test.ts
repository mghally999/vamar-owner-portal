/**
 * Push delivery after the staging QA: failed event pushes are retried with backoff, a cap and a
 * window, and never sent twice; Expo receipts are read and clear dead tokens; signing out stops
 * the phone's pushes; push tokens must look like Expo tokens.
 */
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDailyJobs } from '../src/cron.js';
import {
  checkPushReceipts,
  deliver,
  deliverEvent,
  PUSH_RETRY,
  retryFailedPushes,
  type PendingNotification,
} from '../src/services/notifications.js';
import { createWorld, TODAY, type TestWorld } from './harness.js';

let w: TestWorld;
let ownerId: string;
const TOKEN = 'ExponentPushToken[pushdelivery]';
const { notificationLog: log, pushTickets, devices } = schema;

beforeAll(async () => {
  w = await createWorld();
  ownerId = w.ids.owners['+971500000002']!;
});
afterAll(() => w.close());

beforeEach(async () => {
  await w.db.delete(pushTickets);
  await w.db.delete(log);
  await w.db.delete(devices).where(eq(devices.ownerId, ownerId));
  await w.db
    .insert(devices)
    .values({ ownerId, deviceId: 'push-phone', platform: 'android', pushToken: TOKEN });
});

const reply = (): PendingNotification => ({
  ownerId,
  type: 'message_reply',
  entityId: crypto.randomUUID(),
  date: TODAY,
  params: { type: 'message_reply', subject: 'Water leak' },
});

async function row(entityId: string) {
  const [r] = await w.db.select().from(log).where(eq(log.entityId, entityId));
  if (!r) throw new Error('no notification row');
  return r;
}

/** Make the row's next attempt due now. */
const due = (id: string) =>
  w.db
    .update(log)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(log.id, id));

describe('failed event pushes', () => {
  it('are kept with what they need, retried when due, and sent once', async () => {
    const p = reply();
    const failed = await deliverEvent({ ...w.env, TEST_PUSH: 'fail' }, w.db, [p]);
    expect(failed).toEqual({ sent: 0, skipped: 0, failed: 1 });
    const first = await row(p.entityId);
    expect(first.result).toBe('failed:test');
    expect(first.attempts).toBe(1);
    expect(first.payload).toMatchObject({ params: { type: 'message_reply' } });
    const wait = (first.nextAttemptAt?.getTime() ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(PUSH_RETRY.backoffMs[0] - 60_000);

    // Not due yet: nothing is sent.
    expect(await retryFailedPushes(w.env, w.db)).toEqual({ sent: 0, skipped: 0, failed: 0 });

    await due(first.id);
    const [a, b] = await Promise.all([
      retryFailedPushes(w.env, w.db),
      retryFailedPushes(w.env, w.db),
    ]);
    expect(a.sent + b.sent).toBe(1);
    const after = await row(p.entityId);
    expect(after.result).toBe('ok');
    expect(after.attempts).toBe(2);
    expect(after.payload).toBeNull();
    expect(await w.db.$count(pushTickets, eq(pushTickets.notificationId, after.id))).toBe(1);
    expect(await retryFailedPushes(w.env, w.db)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('back off after each failure and stop at the cap', async () => {
    const p = reply();
    const fail = { ...w.env, TEST_PUSH: 'fail' as const };
    await deliver(fail, w.db, [p]);
    const waits: number[] = [];
    for (let i = 1; i < PUSH_RETRY.maxAttempts; i++) {
      const r = await row(p.entityId);
      await due(r.id);
      expect((await retryFailedPushes(fail, w.db)).failed).toBe(1);
      const next = await row(p.entityId);
      waits.push(next.nextAttemptAt ? next.nextAttemptAt.getTime() - Date.now() : -1);
    }
    const last = await row(p.entityId);
    expect(last.attempts).toBe(PUSH_RETRY.maxAttempts);
    expect(last.result).toBe('failed:test');
    expect(last.nextAttemptAt).toBeNull();
    expect(waits[0]).toBeGreaterThan(PUSH_RETRY.backoffMs[1] - 60_000);
    expect(waits[1]).toBeGreaterThan(PUSH_RETRY.backoffMs[2] - 60_000);
    // Capped: a forced due time still sends nothing, and a regenerated alert is not claimed.
    await due(last.id);
    expect(await retryFailedPushes(w.env, w.db)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(await deliver(w.env, w.db, [p])).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it('are not retried a day after the first attempt', async () => {
    const p = reply();
    await deliver({ ...w.env, TEST_PUSH: 'fail' }, w.db, [p]);
    const r = await row(p.entityId);
    await w.db
      .update(log)
      .set({ createdAt: new Date(Date.now() - PUSH_RETRY.windowMs - 60_000) })
      .where(eq(log.id, r.id));
    await due(r.id);
    expect(await retryFailedPushes(w.env, w.db)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it('a timeout is final: Expo may already have sent it', async () => {
    const p = reply();
    const r = await deliver({ ...w.env, TEST_PUSH: 'timeout' }, w.db, [p]);
    expect(r).toEqual({ sent: 0, skipped: 1, failed: 0 });
    const after = await row(p.entityId);
    expect(after.result).toBe('error:timeout');
    expect(after.nextAttemptAt).toBeNull();
  });

  it('the daily job retries what is due', async () => {
    const p = reply();
    await deliver({ ...w.env, TEST_PUSH: 'fail' }, w.db, [p]);
    await due((await row(p.entityId)).id);
    const summary = await runDailyJobs(w.env);
    expect(summary.retried).toBe(1);
    expect((await row(p.entityId)).result).toBe('ok');
  });

  it('a push for a signed-out device waits for no one: no device is final', async () => {
    await w.db.update(devices).set({ pushToken: null }).where(eq(devices.ownerId, ownerId));
    const p = reply();
    await deliver(w.env, w.db, [p]);
    expect((await row(p.entityId)).result).toBe('no_device');
  });
});

describe('receipts', () => {
  async function sentTicket() {
    const p = reply();
    await deliver(w.env, w.db, [p]);
    const n = await row(p.entityId);
    // Old enough for its receipt.
    await w.db
      .update(pushTickets)
      .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(pushTickets.notificationId, n.id));
    return n;
  }
  const token = async () =>
    (
      await w.db
        .select({ t: devices.pushToken })
        .from(devices)
        .where(and(eq(devices.ownerId, ownerId), eq(devices.deviceId, 'push-phone')))
    )[0]?.t;

  it('DeviceNotRegistered clears the token and marks the push undelivered', async () => {
    const n = await sentTicket();
    const r = await checkPushReceipts({ ...w.env, TEST_PUSH_RECEIPT: 'DeviceNotRegistered' }, w.db);
    expect(r).toEqual({ checked: 1, errors: 1 });
    expect(await token()).toBeNull();
    expect((await row(n.entityId)).result).toBe('undelivered:DeviceNotRegistered');
    expect(await w.db.$count(pushTickets)).toBe(0);
  });

  it('a token registered again since the push is kept', async () => {
    const n = await sentTicket();
    await w.db
      .update(devices)
      .set({ pushToken: 'ExponentPushToken[newer]' })
      .where(eq(devices.deviceId, 'push-phone'));
    await checkPushReceipts({ ...w.env, TEST_PUSH_RECEIPT: 'DeviceNotRegistered' }, w.db);
    expect(await token()).toBe('ExponentPushToken[newer]');
    expect((await row(n.entityId)).result).toBe('undelivered:DeviceNotRegistered');
  });

  it('ok receipts end it; receipts not ready stay; young tickets wait; day-old ones are dropped', async () => {
    const n = await sentTicket();
    await checkPushReceipts({ ...w.env, TEST_PUSH_RECEIPT: 'pending' }, w.db);
    expect(await w.db.$count(pushTickets)).toBe(1);
    await checkPushReceipts(w.env, w.db);
    expect(await w.db.$count(pushTickets)).toBe(0);
    expect((await row(n.entityId)).result).toBe('ok');

    await deliver(w.env, w.db, [reply()]);
    expect((await checkPushReceipts(w.env, w.db)).checked).toBe(0);
    expect(await w.db.$count(pushTickets)).toBe(1);
    await w.db.update(pushTickets).set({ createdAt: new Date(Date.now() - 25 * 3600_000) });
    await checkPushReceipts(w.env, w.db);
    expect(await w.db.$count(pushTickets)).toBe(0);
  });

  it('the morning batch can be read at once (minimum age 0)', async () => {
    await deliver(w.env, w.db, [reply()]);
    expect((await checkPushReceipts(w.env, w.db, 0)).checked).toBe(1);
  });
});

describe('statements', () => {
  it('a batch is claimed and recorded in a fixed number of statements', async () => {
    const pending = Array.from({ length: 30 }, reply);
    const client = w.client as unknown as { query: (...a: unknown[]) => unknown };
    const original = client.query.bind(client);
    let count = 0;
    client.query = (...a: unknown[]) => {
      count += 1;
      return original(...a);
    };
    try {
      expect((await deliver(w.env, w.db, pending)).sent).toBe(30);
    } finally {
      client.query = original;
    }
    // owners, claim, owners+devices, results, tickets (was 2 per notification + 2: 62).
    expect(count).toBeLessThanOrEqual(7);
  });
});

describe('signing out', () => {
  const device = (deviceId: string, pushToken: string | null) => ({
    deviceId,
    platform: 'android',
    model: 'Test',
    pushToken,
  });
  async function signIn(deviceId: string, pushToken: string) {
    const fb = await w.firebaseToken({ phone_number: '+971500000002' });
    const r = await w.json<{ accessToken: string; refreshToken: string }>(
      '/api/auth/owner/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ firebaseIdToken: fb, device: device(deviceId, pushToken) }),
      },
    );
    expect(r.status).toBe(200);
    return r.body;
  }
  const tokenOf = async (deviceId: string) =>
    (
      await w.db
        .select({ t: devices.pushToken, revokedAt: devices.revokedAt })
        .from(devices)
        .where(and(eq(devices.ownerId, ownerId), eq(devices.deviceId, deviceId)))
    )[0];

  it('logout clears that phone’s push token and nothing else', async () => {
    const a = await signIn('logout-phone-a', 'ExponentPushToken[a]');
    await signIn('logout-phone-b', 'ExponentPushToken[b]');
    const out = await w.request('/api/auth/owner/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: a.refreshToken }),
    });
    expect(out.status).toBe(200);
    expect((await tokenOf('logout-phone-a'))?.t).toBeNull();
    expect((await tokenOf('logout-phone-a'))?.revokedAt).toBeNull();
    expect((await tokenOf('logout-phone-b'))?.t).toBe('ExponentPushToken[b]');
    // A second logout with the same (now dead) token changes nothing and still answers ok.
    const again = await w.request('/api/auth/owner/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: a.refreshToken }),
    });
    expect(again.status).toBe(200);
  });

  it('revoke-others clears every other phone’s token and session, and keeps this one', async () => {
    const a = await signIn('others-phone-a', 'ExponentPushToken[oa]');
    const b = await signIn('others-phone-b', 'ExponentPushToken[ob]');
    const c = await signIn('others-phone-c', 'ExponentPushToken[oc]');
    const r = await w.request('/api/auth/owner/devices/revoke-others', {
      method: 'POST',
      token: c.accessToken,
    });
    expect(r.status).toBe(200);
    for (const d of ['others-phone-a', 'others-phone-b']) {
      const row = await tokenOf(d);
      expect(row?.t).toBeNull();
      expect(row?.revokedAt).not.toBeNull();
    }
    expect((await tokenOf('others-phone-c'))?.t).toBe('ExponentPushToken[oc]');
    expect((await w.request('/api/owner/me', { token: a.accessToken })).status).toBe(401);
    expect((await w.request('/api/owner/me', { token: b.accessToken })).status).toBe(401);
    expect((await w.request('/api/owner/me', { token: c.accessToken })).status).toBe(200);
  });
});

describe('push token format', () => {
  it('registration and sign-in refuse anything but an Expo push token', async () => {
    const owner = await w.ownerToken('+971500000002');
    await w.db
      .insert(devices)
      .values({ ownerId, deviceId: 'test-device', platform: 'android' })
      .onConflictDoNothing();
    for (const bad of [
      'not-an-expo-token-at-all',
      'ExponentPushToken[]',
      'ExponentPushToken[a b]',
    ]) {
      const r = await w.request('/api/owner/push-token', {
        method: 'POST',
        token: owner,
        body: JSON.stringify({ deviceId: 'test-device', pushToken: bad }),
      });
      expect(r.status, bad).toBe(422);
    }
    const good = await w.request('/api/owner/push-token', {
      method: 'POST',
      token: owner,
      body: JSON.stringify({ deviceId: 'test-device', pushToken: 'ExpoPushToken[abc_DEF-123]' }),
    });
    expect(good.status).toBe(200);
    const fb = await w.firebaseToken({ phone_number: '+971500000002' });
    const exchange = await w.request('/api/auth/owner/exchange', {
      method: 'POST',
      body: JSON.stringify({
        firebaseIdToken: fb,
        device: { deviceId: 'junk-phone-1', platform: 'ios', model: '', pushToken: 'junk' },
      }),
    });
    expect(exchange.status).toBe(422);
    expect(await w.db.$count(devices, sql`${devices.deviceId} = 'junk-phone-1'`)).toBe(0);
  });
});
