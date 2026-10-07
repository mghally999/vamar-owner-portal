import { schema } from '@vamar/db';
import type { Context } from 'hono';
import type { Dbx } from '../db.js';
import type { AppEnv, Principal } from '../env.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditActor {
  type: 'staff' | 'owner' | 'system';
  id: string | null;
  ip: string | null;
  userAgent: string | null;
}

export function actorFromContext(c: Context<AppEnv>, principal?: Principal): AuditActor {
  return {
    type: principal?.type ?? 'system',
    id: principal?.id ?? null,
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null,
  };
}

/** Writes one audit row. Always call inside the same transaction as the change. */
export async function audit(db: Dbx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    actorType: actor.type,
    actorId: actor.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}
