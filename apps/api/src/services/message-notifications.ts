/**
 * The push an owner gets when staff answer one of their threads. One push per staff message: the
 * dedupe key carries the message id, so a retried request cannot send it twice. The push names
 * the thread's subject only; the answer itself is read in the app. Delivery, dedupe and the
 * device handling are the shared ones in notifications.ts.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { cronDb } from '../db.js';
import type { Bindings } from '../env.js';
import { log } from '../util/log.js';
import { today } from '../util/today.js';
import { deliver, type DeliveryReport } from './notifications.js';

const NOTHING: DeliveryReport = { sent: 0, skipped: 0, failed: 0 };

/** Runs after the answer committed (waitUntil); a failure is logged and never reaches staff. */
export async function queueMessageReplyPush(
  env: Bindings,
  messageId: string,
): Promise<DeliveryReport> {
  const { db, close } = cronDb(env);
  try {
    const [row] = await db
      .select({
        ownerId: schema.messageThreads.ownerId,
        subject: schema.messageThreads.subject,
        senderType: schema.threadMessages.senderType,
      })
      .from(schema.threadMessages)
      .innerJoin(
        schema.messageThreads,
        eq(schema.messageThreads.id, schema.threadMessages.threadId),
      )
      .where(eq(schema.threadMessages.id, messageId));
    if (row?.senderType !== 'staff') return NOTHING;
    const report = await deliver(env, db, [
      {
        ownerId: row.ownerId,
        type: 'message_reply',
        // The message, not the thread: one push per answer. The app opens the thread from it.
        entityId: messageId,
        date: today(env),
        params: { type: 'message_reply', subject: row.subject },
      },
    ]);
    if (report.sent > 0) log('info', 'push.message_reply', { sent: report.sent });
    return report;
  } catch (e) {
    log('error', 'push.message_reply_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return NOTHING;
  } finally {
    await close();
  }
}
