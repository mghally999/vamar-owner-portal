import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { CreateOwnerInput } from '@vamar/shared';
import type { Patch } from '../util/types.js';
import type { Dbx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { decodeCursor, page } from '../util/pagination.js';

const { owners, unitOwnerships, units, buildings, devices } = schema;

export async function listOwners(
  db: Dbx,
  q: {
    search?: string | undefined;
    status?: 'invited' | 'active' | 'disabled' | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  const cursor = decodeCursor(q.cursor);
  const conditions = [];
  if (q.status) conditions.push(eq(owners.status, q.status));
  if (q.search) {
    const s = `%${q.search}%`;
    conditions.push(
      or(ilike(owners.nameAr, s), ilike(owners.nameEn, s), ilike(owners.phoneE164, s)),
    );
  }
  if (cursor) {
    conditions.push(
      or(
        lt(owners.createdAt, new Date(cursor.key)),
        and(eq(owners.createdAt, new Date(cursor.key)), lt(owners.id, cursor.id)),
      ),
    );
  }
  const rows = await db
    .select({
      id: owners.id,
      nameAr: owners.nameAr,
      nameEn: owners.nameEn,
      phoneE164: owners.phoneE164,
      email: owners.email,
      preferredLang: owners.preferredLang,
      status: owners.status,
      createdAt: owners.createdAt,
      unitCount: sql<number>`(select count(*)::int from ${unitOwnerships} uo where uo.owner_id = ${owners.id} and uo.to_date is null)`,
    })
    .from(owners)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(owners.createdAt), desc(owners.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.createdAt.toISOString(), id: r.id }));
}

export async function getOwnerDetail(db: Dbx, id: string) {
  const owner = await db.query.owners.findFirst({ where: eq(owners.id, id) });
  if (!owner) throw notFound('Owner');
  const holdings = await db
    .select({
      unitId: units.id,
      unitNo: units.unitNo,
      type: units.type,
      shareBp: unitOwnerships.shareBp,
      fromDate: unitOwnerships.fromDate,
      buildingId: buildings.id,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
    })
    .from(unitOwnerships)
    .innerJoin(units, eq(units.id, unitOwnerships.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(and(eq(unitOwnerships.ownerId, id), isNull(unitOwnerships.toDate)))
    .orderBy(buildings.nameEn, units.unitNo);
  const ownerDevices = await db
    .select({
      id: devices.id,
      platform: devices.platform,
      model: devices.model,
      firstSeen: devices.firstSeen,
      lastSeen: devices.lastSeen,
      revokedAt: devices.revokedAt,
      hasPushToken: sql<boolean>`${devices.pushToken} is not null`,
    })
    .from(devices)
    .where(eq(devices.ownerId, id))
    .orderBy(desc(devices.lastSeen));
  return { ...owner, holdings, devices: ownerDevices };
}

export async function createOwner(db: Dbx, actor: AuditActor, input: CreateOwnerInput) {
  const existing = await db.query.owners.findFirst({
    where: eq(owners.phoneE164, input.phoneE164),
    columns: { id: true },
  });
  if (existing) throw conflict('An owner with this phone number already exists');
  const [row] = await db
    .insert(owners)
    .values({ ...input, status: 'invited', createdBy: actor.type === 'staff' ? actor.id : null })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'owner.create',
    entityType: 'owner',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateOwner(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateOwnerInput>,
) {
  const before = await db.query.owners.findFirst({ where: eq(owners.id, id) });
  if (!before) throw notFound('Owner');
  if (patch.phoneE164 && patch.phoneE164 !== before.phoneE164) {
    const clash = await db.query.owners.findFirst({
      where: eq(owners.phoneE164, patch.phoneE164),
      columns: { id: true },
    });
    if (clash) throw conflict('An owner with this phone number already exists');
  }
  const [after] = await db
    .update(owners)
    .set(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
    .where(eq(owners.id, id))
    .returning();
  await audit(db, actor, {
    action: 'owner.update',
    entityType: 'owner',
    entityId: id,
    before,
    after,
  });
  return after;
}

export async function setOwnerStatus(
  db: Dbx,
  actor: AuditActor,
  id: string,
  status: 'active' | 'disabled',
) {
  const before = await db.query.owners.findFirst({ where: eq(owners.id, id) });
  if (!before) throw notFound('Owner');
  const [after] = await db.update(owners).set({ status }).where(eq(owners.id, id)).returning();
  if (status === 'disabled') {
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.sessions.subjectType, 'owner'),
          eq(schema.sessions.subjectId, id),
          isNull(schema.sessions.revokedAt),
        ),
      );
  }
  await audit(db, actor, {
    action: `owner.${status === 'disabled' ? 'disable' : 'enable'}`,
    entityType: 'owner',
    entityId: id,
    before,
    after,
  });
  return after;
}
