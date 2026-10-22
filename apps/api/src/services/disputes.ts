import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { CreateDisputeInput, DisputeStatus } from '@vamar/shared';
import type { Dbx } from '../db.js';
import { notFound } from '../errors.js';
import { decodeCursor, page } from '../util/pagination.js';
import { audit, type AuditActor } from './audit.js';
import { listAttachments } from './attachments.js';

const { disputes, disputeUpdates, disputeCounters, units, buildings, tenants, staffUsers } = schema;

export interface DisputeListQuery {
  status?: DisputeStatus | undefined;
  unitId?: string | undefined;
  buildingId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Staff dispute list, newest first; keyset on (opened_at, id). */
export async function listDisputes(db: Dbx, q: DisputeListQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions = [];
  if (q.status) conditions.push(eq(disputes.status, q.status));
  if (q.unitId) conditions.push(eq(disputes.unitId, q.unitId));
  if (q.buildingId) conditions.push(eq(units.buildingId, q.buildingId));
  if (cursor) {
    const key = new Date(cursor.key);
    conditions.push(
      or(lt(disputes.openedAt, key), and(eq(disputes.openedAt, key), lt(disputes.id, cursor.id))),
    );
  }
  const rows = await db
    .select({
      id: disputes.id,
      caseNo: disputes.caseNo,
      type: disputes.type,
      status: disputes.status,
      amountClaimedFils: disputes.amountClaimedFils,
      nextHearingDate: disputes.nextHearingDate,
      openedAt: disputes.openedAt,
      closedAt: disputes.closedAt,
      unitId: units.id,
      unitNo: units.unitNo,
      buildingId: buildings.id,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
    })
    .from(disputes)
    .innerJoin(units, eq(units.id, disputes.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(tenants, eq(tenants.id, disputes.tenantId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(disputes.openedAt), desc(disputes.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.openedAt.toISOString(), id: r.id }));
}

export async function getDisputeDetail(db: Dbx, id: string) {
  const dispute = await db.query.disputes.findFirst({ where: eq(disputes.id, id) });
  if (!dispute) throw notFound('Dispute');
  const [unit, tenant, updates, attachments] = await Promise.all([
    db.query.units.findFirst({ where: eq(units.id, dispute.unitId) }),
    dispute.tenantId
      ? db.query.tenants.findFirst({ where: eq(tenants.id, dispute.tenantId) })
      : Promise.resolve(null),
    db
      .select({
        id: disputeUpdates.id,
        note: disputeUpdates.note,
        visibleToOwner: disputeUpdates.visibleToOwner,
        at: disputeUpdates.at,
        actorName: staffUsers.name,
      })
      .from(disputeUpdates)
      .leftJoin(staffUsers, eq(staffUsers.id, disputeUpdates.actorStaffId))
      .where(eq(disputeUpdates.disputeId, id))
      .orderBy(desc(disputeUpdates.at)),
    listAttachments(db, 'dispute', id),
  ]);
  const building = unit
    ? await db.query.buildings.findFirst({ where: eq(buildings.id, unit.buildingId) })
    : null;
  return { ...dispute, unit, building, tenant: tenant ?? null, updates, attachments };
}

/** Case numbers D-YYYY-NNNN from a per-year counter, locked for the transaction. */
async function nextCaseNo(db: Dbx, year: number): Promise<string> {
  const [row] = await db
    .insert(disputeCounters)
    .values({ year, last: 1 })
    .onConflictDoUpdate({
      target: disputeCounters.year,
      set: { last: sql`${disputeCounters.last} + 1` },
    })
    .returning({ last: disputeCounters.last });
  return `D-${year}-${String(row?.last ?? 1).padStart(4, '0')}`;
}

export async function createDispute(
  db: Dbx,
  actor: AuditActor,
  input: CreateDisputeInput,
  year: number,
) {
  const unit = await db.query.units.findFirst({
    where: eq(units.id, input.unitId),
    columns: { id: true },
  });
  if (!unit) throw notFound('Unit');
  const caseNo = await nextCaseNo(db, year);
  const [row] = await db
    .insert(disputes)
    .values({
      ...input,
      caseNo,
      status: 'open',
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'dispute.create',
    entityType: 'dispute',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateDispute(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: {
    status?: DisputeStatus | undefined;
    amountClaimedFils?: number | null | undefined;
    nextHearingDate?: string | null | undefined;
    notes?: string | undefined;
  },
) {
  const before = await db.query.disputes.findFirst({ where: eq(disputes.id, id) });
  if (!before) throw notFound('Dispute');
  const clean: Record<string, unknown> = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  if (patch.status === 'closed' && before.status !== 'closed') clean['closedAt'] = new Date();
  if (patch.status && patch.status !== 'closed') clean['closedAt'] = null;
  const [after] = await db.update(disputes).set(clean).where(eq(disputes.id, id)).returning();
  await audit(db, actor, {
    action: 'dispute.update',
    entityType: 'dispute',
    entityId: id,
    before,
    after,
  });
  return after;
}

export async function addDisputeUpdate(
  db: Dbx,
  actor: AuditActor,
  disputeId: string,
  input: { note: string; visibleToOwner: boolean },
) {
  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.id, disputeId),
    columns: { id: true },
  });
  if (!dispute) throw notFound('Dispute');
  const [row] = await db
    .insert(disputeUpdates)
    .values({
      disputeId,
      note: input.note,
      visibleToOwner: input.visibleToOwner,
      actorStaffId: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  await audit(db, actor, {
    action: 'dispute.add_update',
    entityType: 'dispute',
    entityId: disputeId,
    after: row,
  });
  return row;
}
