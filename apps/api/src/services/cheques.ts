import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  addDays,
  monthRange,
  planBulkTransition,
  transitionCheque,
  type ChequeStatus,
  type ChequeStatusChangeInput,
  type PlainDate,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { ApiError, conflict, notFound, validation } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { decodeCursor, page } from '../util/pagination.js';

const { cheques, chequeEvents, contracts, units, buildings, tenants, unitOwnerships, staffUsers } =
  schema;

export interface ChequeListQuery {
  month?: string | undefined; // YYYY-MM
  from?: PlainDate | undefined;
  to?: PlainDate | undefined;
  buildingId?: string | undefined;
  unitId?: string | undefined;
  ownerId?: string | undefined;
  status?: ChequeStatus[] | undefined;
  contractId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export const chequeListSelect = {
  id: cheques.id,
  contractId: cheques.contractId,
  seq: cheques.seq,
  dueDate: cheques.dueDate,
  amountFils: cheques.amountFils,
  chequeNo: cheques.chequeNo,
  bankName: cheques.bankName,
  status: cheques.status,
  statusChangedAt: cheques.statusChangedAt,
  bounceReason: cheques.bounceReason,
  replacesChequeId: cheques.replacesChequeId,
  hasImage: sql<boolean>`${cheques.imageKey} is not null`,
  unitId: units.id,
  unitNo: units.unitNo,
  buildingId: buildings.id,
  buildingNameAr: buildings.nameAr,
  buildingNameEn: buildings.nameEn,
  tenantName: tenants.name,
  contractStatus: contracts.status,
};

/** Staff cheque table with filters; keyset on (due_date, id). */
export async function listCheques(db: Dbx, q: ChequeListQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions = [];
  if (q.month) {
    const [y, m] = q.month.split('-').map(Number) as [number, number];
    const r = monthRange(y, m);
    conditions.push(sql`${cheques.dueDate} between ${r.start} and ${r.end}`);
  }
  if (q.from) conditions.push(sql`${cheques.dueDate} >= ${q.from}`);
  if (q.to) conditions.push(sql`${cheques.dueDate} <= ${q.to}`);
  if (q.buildingId) conditions.push(eq(units.buildingId, q.buildingId));
  if (q.unitId) conditions.push(eq(contracts.unitId, q.unitId));
  if (q.contractId) conditions.push(eq(cheques.contractId, q.contractId));
  if (q.status?.length) conditions.push(inArray(cheques.status, q.status));
  if (q.ownerId) {
    conditions.push(
      inArray(
        contracts.unitId,
        db
          .select({ u: unitOwnerships.unitId })
          .from(unitOwnerships)
          .where(and(eq(unitOwnerships.ownerId, q.ownerId), isNull(unitOwnerships.toDate))),
      ),
    );
  }
  // Drafts are not real cheques yet.
  conditions.push(sql`${contracts.status} <> 'draft'`);
  if (cursor) {
    conditions.push(
      or(
        gt(cheques.dueDate, cursor.key),
        and(eq(cheques.dueDate, cursor.key), gt(cheques.id, cursor.id)),
      ),
    );
  }
  const rows = await db
    .select(chequeListSelect)
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(...conditions))
    .orderBy(asc(cheques.dueDate), asc(cheques.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.dueDate, id: r.id }));
}

export async function getChequeDetail(db: Dbx, id: string) {
  const [row] = await db
    .select({
      ...chequeListSelect,
      imageKey: cheques.imageKey,
      depositedAt: cheques.depositedAt,
      clearedAt: cheques.clearedAt,
      bouncedAt: cheques.bouncedAt,
      tenantId: tenants.id,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(eq(cheques.id, id));
  if (!row) throw notFound('Cheque');
  const timeline = await db
    .select({
      id: chequeEvents.id,
      fromStatus: chequeEvents.fromStatus,
      toStatus: chequeEvents.toStatus,
      note: chequeEvents.note,
      at: chequeEvents.at,
      actorName: staffUsers.name,
    })
    .from(chequeEvents)
    .leftJoin(staffUsers, eq(staffUsers.id, chequeEvents.actorStaffId))
    .where(eq(chequeEvents.chequeId, id))
    .orderBy(asc(chequeEvents.at), asc(chequeEvents.id));
  const replacement = await db.query.cheques.findFirst({
    where: eq(cheques.replacesChequeId, id),
    columns: { id: true, chequeNo: true, dueDate: true, amountFils: true, status: true },
  });
  return { ...row, timeline, replacedBy: replacement ?? null };
}

export interface ChequeRowPatch {
  dueDate?: PlainDate | undefined;
  amountFils?: number | null | undefined;
  chequeNo?: string | null | undefined;
  bankName?: string | null | undefined;
}

export async function updateChequeRow(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: ChequeRowPatch,
) {
  const before = await db.query.cheques.findFirst({ where: eq(cheques.id, id) });
  if (!before) throw notFound('Cheque');
  if (before.status !== 'upcoming') throw conflict('Only upcoming cheques can be edited');
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [after] = await db.update(cheques).set(clean).where(eq(cheques.id, id)).returning();
  await audit(db, actor, {
    action: 'cheque.update',
    entityType: 'cheque',
    entityId: id,
    before,
    after,
  });
  return after;
}

export interface StatusChangeResult {
  cheque: typeof cheques.$inferSelect;
  replacement: typeof cheques.$inferSelect | null;
  notifyOwners: boolean;
}

/**
 * Move one cheque through the state machine. Writes the cheque_events row and the audit row in
 * the same transaction. `replaced` creates the replacement cheque here as well.
 */
export async function changeChequeStatus(
  db: Dbx,
  actor: AuditActor,
  isAdmin: boolean,
  id: string,
  input: ChequeStatusChangeInput,
): Promise<StatusChangeResult> {
  const before = await db.query.cheques.findFirst({ where: eq(cheques.id, id) });
  if (!before) throw notFound('Cheque');
  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, before.contractId),
    columns: { status: true, id: true },
  });
  if (!contract || contract.status === 'draft')
    throw conflict('Cheques of a draft contract have no status yet');
  if (before.amountFils === null)
    throw conflict('Enter the cheque amount before changing its status');

  let effects;
  try {
    effects = transitionCheque(before.status, input.to, {
      adminOverride: isAdmin && input.overrideReason ? { reason: input.overrideReason } : undefined,
    });
  } catch (e) {
    throw new ApiError(
      422,
      'invalid_transition',
      e instanceof Error ? e.message : 'Invalid transition',
    );
  }
  if (effects.requiresReplacementCheque && !input.replacement) {
    throw validation('A replacement cheque is required when marking a cheque as replaced');
  }
  if (input.to === 'bounced' && !input.bounceReason?.trim()) {
    throw validation('A bounce reason is required');
  }

  const now = new Date();
  const set: Partial<typeof cheques.$inferInsert> = { status: input.to, statusChangedAt: now };
  if (effects.stamp === 'deposited_at') set.depositedAt = now;
  if (effects.stamp === 'cleared_at') set.clearedAt = now;
  if (effects.stamp === 'bounced_at') {
    set.bouncedAt = now;
    set.bounceReason = input.bounceReason ?? null;
  }
  const [after] = await db.update(cheques).set(set).where(eq(cheques.id, id)).returning();
  if (!after) throw new Error('update failed');

  const note = [
    input.note,
    effects.overrideReason ? `Admin correction: ${effects.overrideReason}` : '',
    input.to === 'bounced' ? input.bounceReason : '',
  ]
    .filter((s): s is string => Boolean(s?.trim()))
    .join(' | ');
  await db.insert(chequeEvents).values({
    chequeId: id,
    fromStatus: before.status,
    toStatus: input.to,
    note,
    actorStaffId: actor.type === 'staff' ? actor.id : null,
    at: now,
  });

  let replacement: typeof cheques.$inferSelect | null = null;
  if (input.replacement) {
    const [maxSeq] = await db
      .select({ m: sql<number>`coalesce(max(${cheques.seq}), 0)::int` })
      .from(cheques)
      .where(eq(cheques.contractId, before.contractId));
    const seq = (maxSeq?.m ?? 0) + 1;
    if (seq > 12)
      throw conflict(
        'This contract already has 12 cheques; cancel one before adding a replacement',
      );
    const [rep] = await db
      .insert(cheques)
      .values({
        contractId: before.contractId,
        seq,
        dueDate: input.replacement.dueDate,
        amountFils: input.replacement.amountFils,
        chequeNo: input.replacement.chequeNo,
        bankName: input.replacement.bankName,
        status: 'upcoming',
        replacesChequeId: id,
      })
      .returning();
    replacement = rep ?? null;
    if (rep) {
      await db
        .insert(chequeEvents)
        .values({
          chequeId: rep.id,
          fromStatus: null,
          toStatus: 'upcoming',
          note: `Replaces cheque ${before.chequeNo ?? ''}`.trim(),
          actorStaffId: actor.type === 'staff' ? actor.id : null,
          at: now,
        });
    }
  }

  await audit(db, actor, {
    action: 'cheque.status_change',
    entityType: 'cheque',
    entityId: id,
    before,
    after: { ...after, replacement, overrideReason: effects.overrideReason },
  });
  return { cheque: after, replacement, notifyOwners: effects.notifyOwners };
}

export interface BulkResult {
  ok: string[];
  failed: { id: string; reason: string }[];
  notifyChequeIds: string[];
}

/** Bulk status update: each cheque validated on its own; partial failures reported. */
export async function bulkChangeChequeStatus(
  db: Dbx,
  actor: AuditActor,
  ids: string[],
  to: ChequeStatus,
  note: string,
): Promise<BulkResult> {
  const rows = await db
    .select({
      id: cheques.id,
      status: cheques.status,
      amountFils: cheques.amountFils,
      contractStatus: contracts.status,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .where(inArray(cheques.id, ids));
  const result: BulkResult = { ok: [], failed: [], notifyChequeIds: [] };
  for (const id of ids)
    if (!rows.some((r) => r.id === id)) result.failed.push({ id, reason: 'Cheque not found' });
  const plan = planBulkTransition(
    rows.map((r) => ({ id: r.id, from: r.status })),
    to,
  );
  for (const f of plan.failed) result.failed.push({ id: f.id, reason: f.reason });
  for (const item of plan.ok) {
    const row = rows.find((r) => r.id === item.id);
    if (!row) continue;
    if (row.contractStatus === 'draft') {
      result.failed.push({ id: item.id, reason: 'Contract is still a draft' });
      continue;
    }
    if (row.amountFils === null) {
      result.failed.push({ id: item.id, reason: 'Amount not entered' });
      continue;
    }
    if (to === 'bounced' && !note.trim()) {
      result.failed.push({ id: item.id, reason: 'Bounce reason required' });
      continue;
    }
    const r = await changeChequeStatus(db, actor, false, item.id, {
      to,
      note,
      bounceReason: to === 'bounced' ? note : undefined,
      overrideReason: undefined,
      replacement: undefined,
    });
    result.ok.push(item.id);
    if (r.notifyOwners) result.notifyChequeIds.push(item.id);
  }
  return result;
}

/** Cheques whose due date is within the next N days and still pending (dashboard overview). */
export async function pendingDueSoon(db: Dbx, todayDate: PlainDate, days: number) {
  return db
    .select(chequeListSelect)
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        inArray(cheques.status, ['upcoming', 'deposited']),
        sql`${cheques.dueDate} between ${todayDate} and ${addDays(todayDate, days)}`,
        sql`${contracts.status} <> 'draft'`,
      ),
    )
    .orderBy(asc(cheques.dueDate))
    .limit(50);
}

export async function bouncedNeedingAction(db: Dbx) {
  return db
    .select(chequeListSelect)
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(eq(cheques.status, 'bounced'))
    .orderBy(desc(cheques.bouncedAt))
    .limit(50);
}

export { lt };
