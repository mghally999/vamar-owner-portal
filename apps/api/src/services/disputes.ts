import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { CreateDisputeInput, DisputeStatus } from '@vamar/shared';
import { orSql, type Dbx } from '../db.js';
import { ApiError, notFound, validation } from '../errors.js';
import { decodeCursor, page } from '../util/pagination.js';
import { audit, type AuditActor } from './audit.js';
import { listAttachments } from './attachments.js';

const {
  disputes,
  disputeUpdates,
  disputeCounters,
  disputeCheques,
  cheques,
  contracts,
  units,
  buildings,
  tenants,
  staffUsers,
} = schema;

/** Cheque numbers of a case, oldest due first, for every list and notification. */
export const chequeNosSql = sql<
  string[]
>`coalesce((select array_agg(q.cheque_no order by q.due_date) from ${disputeCheques} dc join ${cheques} q on q.id = dc.cheque_id where dc.dispute_id = ${disputes.id} and q.cheque_no is not null), '{}')`;

export interface DisputeListQuery {
  status?: DisputeStatus | undefined;
  unitId?: string | undefined;
  buildingId?: string | undefined;
  /** Case number or cheque number. */
  search?: string | undefined;
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
  if (q.search) {
    const like = `%${q.search}%`;
    conditions.push(
      orSql(
        sql`${disputes.caseNo} ilike ${like}`,
        sql`exists (select 1 from ${disputeCheques} dc join ${cheques} q on q.id = dc.cheque_id where dc.dispute_id = ${disputes.id} and q.cheque_no ilike ${like})`,
      ),
    );
  }
  if (cursor) {
    const key = new Date(cursor.key);
    conditions.push(
      orSql(
        lt(disputes.openedAt, key),
        and(eq(disputes.openedAt, key), lt(disputes.id, cursor.id)),
      ),
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
      chequeNos: chequeNosSql,
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
  const linkedCheques = await disputeChequeRows(db, id);
  const building = unit
    ? await db.query.buildings.findFirst({ where: eq(buildings.id, unit.buildingId) })
    : null;
  return {
    ...dispute,
    unit,
    building,
    tenant: tenant ?? null,
    updates,
    attachments,
    cheques: linkedCheques,
  };
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
  input: CreateDisputeInput & { chequeIds?: string[] | undefined },
  year: number,
) {
  const unit = await db.query.units.findFirst({
    where: eq(units.id, input.unitId),
    columns: { id: true },
  });
  if (!unit) throw notFound('Unit');
  const { chequeIds: rawChequeIds = [], ...fields } = input;
  // The same cheque named twice is linked once.
  const chequeIds = [...new Set(rawChequeIds)];
  if (input.type === 'bounced_cheque' && chequeIds.length === 0)
    throw validation('A bounced-cheque case needs at least one cheque', { path: 'chequeIds' });
  await assertChequesOnUnit(db, input.unitId, chequeIds);
  const caseNo = await nextCaseNo(db, year);
  const [row] = await db
    .insert(disputes)
    .values({
      ...fields,
      caseNo,
      status: 'open',
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  if (chequeIds.length)
    await db
      .insert(disputeCheques)
      .values(chequeIds.map((chequeId) => ({ disputeId: row.id, chequeId })));
  await audit(db, actor, {
    action: 'dispute.create',
    entityType: 'dispute',
    entityId: row.id,
    after: { ...row, chequeIds },
  });
  return { ...row, chequeIds };
}

/** The cheques of a case must belong to contracts on its unit. */
async function assertChequesOnUnit(db: Dbx, unitId: string, chequeIds: string[]) {
  if (chequeIds.length === 0) return;
  const rows = await db
    .select({ id: cheques.id })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .where(and(inArray(cheques.id, chequeIds), eq(contracts.unitId, unitId)));
  if (rows.length !== new Set(chequeIds).size)
    throw validation('Every cheque must belong to a contract on the unit of the case', {
      path: 'chequeIds',
    });
}

export async function disputeChequeRows(db: Dbx, disputeId: string) {
  return db
    .select({
      id: cheques.id,
      chequeNo: cheques.chequeNo,
      bankName: cheques.bankName,
      amountFils: cheques.amountFils,
      dueDate: cheques.dueDate,
      status: cheques.status,
      bouncedAt: cheques.bouncedAt,
      bounceReason: cheques.bounceReason,
      contractId: cheques.contractId,
    })
    .from(disputeCheques)
    .innerJoin(cheques, eq(cheques.id, disputeCheques.chequeId))
    .where(eq(disputeCheques.disputeId, disputeId))
    .orderBy(cheques.dueDate);
}

/** Replace the cheques a case is about; a bounced-cheque case keeps at least one. */
export async function setDisputeCheques(
  db: Dbx,
  actor: AuditActor,
  disputeId: string,
  chequeIds: string[],
) {
  const dispute = await db.query.disputes.findFirst({ where: eq(disputes.id, disputeId) });
  if (!dispute) throw notFound('Dispute');
  const ids = [...new Set(chequeIds)];
  if (dispute.type === 'bounced_cheque' && ids.length === 0)
    throw new ApiError(422, 'validation', 'A bounced-cheque case needs at least one cheque');
  await assertChequesOnUnit(db, dispute.unitId, ids);
  const before = await disputeChequeRows(db, disputeId);
  await db.delete(disputeCheques).where(eq(disputeCheques.disputeId, disputeId));
  if (ids.length)
    await db.insert(disputeCheques).values(ids.map((chequeId) => ({ disputeId, chequeId })));
  const after = await disputeChequeRows(db, disputeId);
  await audit(db, actor, {
    action: 'dispute.set_cheques',
    entityType: 'dispute',
    entityId: disputeId,
    before: before.map((c) => c.id),
    after: after.map((c) => c.id),
  });
  return after;
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
