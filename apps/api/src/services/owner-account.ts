import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { Context } from 'hono';
import type { Dbx } from '../db.js';
import type { AppEnv } from '../env.js';
import { notFound } from '../errors.js';
import { audit, actorFromContext } from './audit.js';
import { revokeSessions } from '../auth/tokens.js';

/**
 * Owner-initiated account deletion request: the account is disabled immediately, every session
 * and device token revoked, and an audit row with action `owner.delete_requested` is written.
 * The dashboard lists these for staff to complete the deletion offline.
 */
export async function requestAccountDeletion(
  db: Dbx,
  c: Context<AppEnv>,
  ownerId: string,
  reason: string,
): Promise<void> {
  const before = await db.query.owners.findFirst({ where: eq(schema.owners.id, ownerId) });
  if (!before) throw notFound('Owner');
  const [after] = await db
    .update(schema.owners)
    .set({ status: 'disabled' })
    .where(eq(schema.owners.id, ownerId))
    .returning();
  await revokeSessions(
    db,
    and(
      eq(schema.sessions.subjectType, 'owner'),
      eq(schema.sessions.subjectId, ownerId),
      isNull(schema.sessions.revokedAt),
    ),
  );
  await db
    .update(schema.devices)
    .set({ revokedAt: new Date(), pushToken: null })
    .where(eq(schema.devices.ownerId, ownerId));
  await audit(db, actorFromContext(c, c.get('principal')), {
    action: 'owner.delete_requested',
    entityType: 'owner',
    entityId: ownerId,
    before,
    after: { ...after, reason },
  });
}
