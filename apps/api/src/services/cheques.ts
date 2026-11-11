import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  addDays,
  canTransitionCheque,
  monthRange,
  transitionCheque,
  type BulkChequeStatusChangeInput,
  type ChequeStatus,
  type ChequeStatusChangeInput,
  type PlainDate,
  MAX_CHEQUE_COUNT,
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
 * The instant stored for a bank date: midday in Dubai, so the date reads the same in any time
 * zone staff or owners view it from. Today's date keeps the real time of the change.
 */
function bankDateInstant(date: PlainDate, now: Date, todayDate: PlainDate): Date {
  return date === todayDate ? now : new Date(`${date}T12:00:00+04:00`);
}

/**
 * Move one cheque through the state machine. Writes the cheque_events row and the audit row in
 * the same transaction. `replaced` creates the replacement cheque here as well.
 * `bankDate` (bulk changes and bank matching) is the day the bank deposited, cleared or returned
 * the cheque; it is stamped on deposited_at / cleared_at / bounced_at and noted on the event.
 */
export async function changeChequeStatus(
  db: Dbx,
  actor: AuditActor,
  isAdmin: boolean,
  id: string,
  input: ChequeStatusChangeInput,
  bankDate?: { date: PlainDate; today: PlainDate },
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
  const stampAt = bankDate ? bankDateInstant(bankDate.date, now, bankDate.today) : now;
  const set: Partial<typeof cheques.$inferInsert> = { status: input.to, statusChangedAt: now };
  if (effects.stamp === 'deposited_at') set.depositedAt = stampAt;
  if (effects.stamp === 'cleared_at') set.clearedAt = stampAt;
  if (effects.stamp === 'bounced_at') {
    set.bouncedAt = stampAt;
    set.bounceReason = input.bounceReason ?? null;
  }
  const [after] = await db.update(cheques).set(set).where(eq(cheques.id, id)).returning();
  if (!after) throw new Error('update failed');

  const note = [
    input.note,
    effects.overrideReason ? `Admin correction: ${effects.overrideReason}` : '',
    input.to === 'bounced' ? input.bounceReason : '',
    bankDate ? `Bank date ${bankDate.date}` : '',
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
    if (seq > MAX_CHEQUE_COUNT)
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
      await db.insert(chequeEvents).values({
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

export type BulkRejectionCode = 'not_found' | 'invalid_transition' | 'draft_contract' | 'no_amount';

export interface BulkRejection {
  id: string;
  chequeNo: string | null;
  from: ChequeStatus | null;
  code: BulkRejectionCode;
  reason: string;
}

export interface BulkResult {
  updated: string[];
  /** Cheques whose owners get the bounce alert, exactly as a single bounce would send it. */
  notifyChequeIds: string[];
}

/**
 * One status change for many cheques, all or nothing. Every cheque is checked first against the
 * same rules as a single change (state machine, draft contract, amount entered); if any fails,
 * nothing is written and the error lists each refused cheque. Otherwise each cheque goes through
 * changeChequeStatus, so the cheque_events and audit rows are the ones a single change writes.
 * The caller runs this inside one transaction, so a failure part-way also undoes everything.
 */
export async function bulkChangeChequeStatus(
  db: Dbx,
  actor: AuditActor,
  input: BulkChequeStatusChangeInput,
  todayDate: PlainDate,
): Promise<BulkResult> {
  if (input.date && input.date > todayDate) throw validation('The date cannot be in the future');
  const ids = [...new Set(input.ids)];
  const rows = await db
    .select({
      id: cheques.id,
      chequeNo: cheques.chequeNo,
      status: cheques.status,
      amountFils: cheques.amountFils,
      contractStatus: contracts.status,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .where(inArray(cheques.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const rejected: BulkRejection[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      rejected.push({
        id,
        chequeNo: null,
        from: null,
        code: 'not_found',
        reason: 'Cheque not found',
      });
      continue;
    }
    const base = { id, chequeNo: row.chequeNo, from: row.status };
    if (row.contractStatus === 'draft')
      rejected.push({ ...base, code: 'draft_contract', reason: 'Contract is still a draft' });
    else if (row.amountFils === null)
      rejected.push({ ...base, code: 'no_amount', reason: 'Amount not entered' });
    else if (!canTransitionCheque(row.status, input.status))
      rejected.push({
        ...base,
        code: 'invalid_transition',
        reason: `Cannot move a cheque from ${row.status} to ${input.status}`,
      });
  }
  if (rejected.length) {
    throw new ApiError(
      422,
      'invalid_transition',
      `${String(rejected.length)} of ${String(ids.length)} cheques cannot be marked ${input.status}; nothing was changed`,
      { rejected },
    );
  }

  const result: BulkResult = { updated: [], notifyChequeIds: [] };
  for (const id of ids) {
    const r = await changeChequeStatus(
      db,
      actor,
      false,
      id,
      {
        to: input.status,
        note: input.note ?? '',
        bounceReason: input.status === 'bounced' ? input.reason : undefined,
        overrideReason: undefined,
        replacement: undefined,
      },
      // A cancellation has no bank date to stamp, exactly as a single cancel.
      input.date && input.status !== 'cancelled'
        ? { date: input.date, today: todayDate }
        : undefined,
    );
    result.updated.push(id);
    if (r.notifyOwners) result.notifyChequeIds.push(id);
  }
  return result;
}

/**
 * Cheques a bank statement can settle: upcoming ones due in the statement's window and every
 * deposited one still waiting to clear (those can be weeks old). depositedOn is the Dubai date.
 */
export async function bankMatchCandidates(db: Dbx, from: PlainDate, to: PlainDate) {
  return db
    .select({
      id: cheques.id,
      chequeNo: cheques.chequeNo,
      bankName: cheques.bankName,
      amountFils: cheques.amountFils,
      dueDate: cheques.dueDate,
      status: cheques.status,
      depositedOn: sql<PlainDate | null>`to_char(${cheques.depositedAt} at time zone 'Asia/Dubai', 'YYYY-MM-DD')`,
      unitNo: units.unitNo,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        sql`${contracts.status} <> 'draft'`,
        or(
          eq(cheques.status, 'deposited'),
          and(eq(cheques.status, 'upcoming'), sql`${cheques.dueDate} between ${from} and ${to}`),
        ),
      ),
    )
    .orderBy(asc(cheques.dueDate), asc(cheques.id))
    .limit(5000);
}

/** Cheques whose due date is within the next N days and still pending (dashboard overview). */
export async function pendingDueSoon(db: Dbx, todayDate: PlainDate, days: number, limit = 50) {
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
    .limit(limit);
}

export async function bouncedNeedingAction(db: Dbx, limit = 50) {
  return db
    .select(chequeListSelect)
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(eq(cheques.status, 'bounced'))
    .orderBy(desc(cheques.bouncedAt), desc(cheques.id))
    .limit(limit);
}
