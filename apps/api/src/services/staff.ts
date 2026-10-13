import { and, desc, eq, gte, lte, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { StaffRole } from '@vamar/shared';
import type { Dbx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { decodeCursor, page } from '../util/pagination.js';

const { staffUsers, auditLog } = schema;

export async function listStaff(db: Dbx) {
  return db
    .select({
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      role: staffUsers.role,
      totpEnabled: staffUsers.totpEnabled,
      totpRequired: staffUsers.totpRequired,
      active: staffUsers.active,
      createdAt: staffUsers.createdAt,
    })
    .from(staffUsers)
    .orderBy(staffUsers.name);
}

/** Invite: creates the row; the Firebase account is created by the admin in Firebase (or on first login the uid binds). */
export async function inviteStaff(
  db: Dbx,
  actor: AuditActor,
  input: { email: string; name: string; role: StaffRole },
) {
  const email = input.email.toLowerCase();
  const clash = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, email),
    columns: { id: true },
  });
  if (clash) throw conflict('A staff user with this email already exists');
  const [row] = await db
    .insert(staffUsers)
    .values({
      email,
      name: input.name,
      role: input.role,
      firebaseUid: `invite:${crypto.randomUUID()}`,
      active: true,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'staff.invite',
    entityType: 'staff_user',
    entityId: row.id,
    after: { id: row.id, email, name: row.name, role: row.role },
  });
  return row;
}

export async function updateStaff(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: {
    name?: string | undefined;
    role?: StaffRole | undefined;
    active?: boolean | undefined;
    totpRequired?: boolean | undefined;
  },
) {
  const before = await db.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
  if (!before) throw notFound('Staff user');
  if (actor.id === id && patch.role && patch.role !== 'admin')
    throw conflict('You cannot remove your own admin role');
  if (actor.id === id && patch.active === false) throw conflict('You cannot deactivate yourself');
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [after] = await db.update(staffUsers).set(clean).where(eq(staffUsers.id, id)).returning();
  if (patch.active === false) {
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.subjectType, 'staff'), eq(schema.sessions.subjectId, id)));
  }
  await audit(db, actor, {
    action: 'staff.update',
    entityType: 'staff_user',
    entityId: id,
    before: strip(before),
    after: after ? strip(after) : null,
  });
  return after ? strip(after) : null;
}

export async function resetStaffTotp(db: Dbx, actor: AuditActor, id: string) {
  const before = await db.query.staffUsers.findFirst({ where: eq(staffUsers.id, id) });
  if (!before) throw notFound('Staff user');
  await db
    .update(staffUsers)
    .set({ totpSecretEnc: null, totpEnabled: false, totpFailures: 0, totpLockedUntil: null })
    .where(eq(staffUsers.id, id));
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.subjectType, 'staff'), eq(schema.sessions.subjectId, id)));
  await audit(db, actor, { action: 'staff.totp_reset', entityType: 'staff_user', entityId: id });
}

function strip(u: typeof staffUsers.$inferSelect) {
  const { totpSecretEnc: _s, ...rest } = u;
  return rest;
}

export interface AuditQuery {
  actorId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function queryAudit(db: Dbx, q: AuditQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions = [];
  if (q.actorId) conditions.push(eq(auditLog.actorId, q.actorId));
  if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLog.entityId, q.entityId));
  if (q.action) conditions.push(sql`${auditLog.action} like ${q.action + '%'}`);
  if (q.from) conditions.push(gte(auditLog.at, new Date(q.from)));
  if (q.to) conditions.push(lte(auditLog.at, new Date(`${q.to}T23:59:59.999Z`)));
  if (cursor)
    conditions.push(
      or(
        lt(auditLog.at, new Date(cursor.key)),
        and(eq(auditLog.at, new Date(cursor.key)), lt(auditLog.id, cursor.id)),
      ),
    );
  const rows = await db
    .select({
      id: auditLog.id,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      actorName: staffUsers.name,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      ip: auditLog.ip,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLog.actorId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.at.toISOString(), id: r.id }));
}
