/**
 * Owner approval of large repairs. A work order whose estimate, or a variable expense draft whose
 * total, is at or above the admin's threshold asks every owner with a share in it (the unit's
 * owners, or the building's for a building-wide job, on the day asked) to approve. While any
 * answer is pending or rejected the job cannot start and the expense cannot be posted, unless an
 * admin overrides with a written reason. Unanswered requests count as approved after the
 * admin's number of days (the daily cron). Every request, answer and override is an audit row.
 */
import { and, asc, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { schema } from '@vamar/db';
import {
  allocateExpense,
  APPROVAL_ASKABLE_WORK_ORDER_STATUSES,
  approvalsBlock,
  approvalState,
  defaultAllocationMethod,
  isBlockingApproval,
  needsOwnerApproval,
  ownersOnDate,
  silenceCutoff,
  silenceDeadline,
  type AllocationMethod,
  type AllocationUnit,
  type AnswerApprovalInput,
  type PlainDate,
  type RepairApprovalStatus,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { audit, type AuditActor } from './audit.js';

const {
  repairApprovals,
  workOrders,
  expenses,
  units,
  buildings,
  unitOwnerships,
  owners,
  vendors,
  staffUsers,
} = schema;

export type ApprovalSubject = { workOrderId: string } | { expenseId: string };

type ApprovalRow = typeof repairApprovals.$inferSelect;

function subjectCondition(subject: ApprovalSubject): SQL {
  return 'workOrderId' in subject
    ? eq(repairApprovals.workOrderId, subject.workOrderId)
    : eq(repairApprovals.expenseId, subject.expenseId);
}

function subjectAudit(subject: ApprovalSubject) {
  return 'workOrderId' in subject
    ? { entityType: 'work_order', entityId: subject.workOrderId }
    : { entityType: 'expense', entityId: subject.expenseId };
}

async function rowsOf(db: Dbx, subject: ApprovalSubject): Promise<ApprovalRow[]> {
  return db.select().from(repairApprovals).where(subjectCondition(subject));
}

// Who is asked, and for how much ----------------------------------------------------------------

/**
 * Each owner's part of `amountFils` on `date`: the unit's owners for a unit job, the owners of
 * the building's active units for a building-wide one, split as the expense would be. A unit
 * nobody held on that date falls back to its current owners; a unit with no owners at all is
 * left out rather than failing the job. Disabled owners cannot sign in to answer, so they are
 * not asked.
 */
export async function ownerSharesFor(
  db: Dbx,
  input: {
    buildingId: string;
    unitId: string | null;
    date: PlainDate;
    amountFils: number;
    /** The expense's own method; omitted for a work order (the building default). */
    method?: AllocationMethod | undefined;
  },
): Promise<Map<string, number>> {
  const unitRows = await db
    .select({ id: units.id, sizeSqft: units.sizeSqft })
    .from(units)
    .where(
      input.unitId !== null
        ? and(eq(units.id, input.unitId), eq(units.buildingId, input.buildingId))
        : and(eq(units.buildingId, input.buildingId), eq(units.active, true)),
    );
  if (unitRows.length === 0) return new Map();
  const holdings = await db
    .select({
      unitId: unitOwnerships.unitId,
      ownerId: unitOwnerships.ownerId,
      shareBp: unitOwnerships.shareBp,
      fromDate: unitOwnerships.fromDate,
      toDate: unitOwnerships.toDate,
    })
    .from(unitOwnerships)
    .where(
      inArray(
        unitOwnerships.unitId,
        unitRows.map((u) => u.id),
      ),
    );
  const typed = holdings.map((r) => ({
    ...r,
    fromDate: r.fromDate as PlainDate,
    toDate: r.toDate as PlainDate | null,
  }));
  const allocationUnits: AllocationUnit[] = [];
  for (const u of unitRows) {
    let holders = ownersOnDate(typed, u.id, input.date);
    if (holders.length === 0)
      holders = typed
        .filter((r) => r.unitId === u.id && r.toDate === null)
        .map((r) => ({ ownerId: r.ownerId, shareBp: r.shareBp }));
    if (holders.length > 0)
      allocationUnits.push({ unitId: u.id, sizeSqft: u.sizeSqft, owners: holders });
  }
  if (allocationUnits.length === 0) return new Map();
  let method: AllocationMethod =
    input.unitId !== null
      ? 'single_unit'
      : (input.method ?? defaultAllocationMethod(allocationUnits));
  // A unit left out above may have been the one without a size; by_area still needs every size.
  if (method === 'single_unit' && allocationUnits.length !== 1) method = 'equal_units';
  if (method === 'by_area' && defaultAllocationMethod(allocationUnits) !== 'by_area')
    method = 'equal_units';
  const shares = new Map<string, number>();
  for (const p of allocateExpense(input.amountFils, method, allocationUnits))
    shares.set(p.ownerId, (shares.get(p.ownerId) ?? 0) + p.amountFils);
  const ownerIds = [...shares.keys()];
  const disabled = await db
    .select({ id: owners.id })
    .from(owners)
    .where(and(inArray(owners.id, ownerIds), eq(owners.status, 'disabled')));
  for (const d of disabled) shares.delete(d.id);
  return shares;
}

interface SubjectFacts {
  buildingId: string;
  unitId: string | null;
  amountFils: number | null;
  visibleToOwner: boolean;
  /** The work has not started (work order open or scheduled; expense still a draft). */
  waiting: boolean;
  /** Only variable expenses are repairs; fixed costs (salaries, DEWA) are never asked about. */
  eligible: boolean;
  date: PlainDate;
  method?: AllocationMethod | undefined;
}

async function subjectFacts(
  db: Dbx,
  subject: ApprovalSubject,
  today: PlainDate,
): Promise<SubjectFacts | null> {
  if ('workOrderId' in subject) {
    const wo = await db.query.workOrders.findFirst({
      where: eq(workOrders.id, subject.workOrderId),
    });
    if (!wo) return null;
    return {
      buildingId: wo.buildingId,
      unitId: wo.unitId,
      amountFils: wo.estimateFils,
      visibleToOwner: wo.visibleToOwner,
      waiting: APPROVAL_ASKABLE_WORK_ORDER_STATUSES.includes(wo.status),
      eligible: true,
      // The owners asked are the owners on the day the job asks them.
      date: today,
    };
  }
  const x = await db.query.expenses.findFirst({ where: eq(expenses.id, subject.expenseId) });
  if (!x) return null;
  return {
    buildingId: x.buildingId,
    unitId: x.scope === 'unit' ? x.unitId : null,
    amountFils: x.totalFils,
    visibleToOwner: x.visibleToOwner,
    waiting: x.status === 'draft',
    eligible: x.kind === 'variable',
    // An expense is shared by the ownership on its invoice date, so its approvals are too.
    date: x.invoiceDate as PlainDate,
    method: x.allocationMethod,
  };
}

/** The work order that an expense pays for, if any. */
async function linkedWorkOrderId(db: Dbx, expenseId: string): Promise<string | null> {
  const [wo] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(eq(workOrders.expenseId, expenseId))
    .limit(1);
  return wo?.id ?? null;
}

/**
 * Ask the owners when the job needs it and they have not been asked about this much already.
 * Returns the ids of the new requests (the caller sends the pushes after the commit). A higher
 * estimate than the one approved asks again: the earlier answers are replaced (and kept in the
 * audit log). `evenIfStarted` evaluates a work order as it was before a status change in the same
 * request, so a job cannot skip the question by being created or moved straight to in progress.
 */
export async function requestApprovals(
  db: Dbx,
  actor: AuditActor,
  subject: ApprovalSubject,
  thresholdFils: number,
  today: PlainDate,
  opts: { evenIfStarted?: boolean } = {},
): Promise<string[]> {
  const facts = await subjectFacts(db, subject, today);
  if (!facts) return [];
  if (!facts.eligible || !facts.visibleToOwner) return [];
  if (!facts.waiting && !opts.evenIfStarted) return [];
  const amountFils = facts.amountFils;
  if (amountFils === null || !needsOwnerApproval(amountFils, thresholdFils)) return [];
  // An expense that pays for a job the owners already approved is not asked about twice.
  if ('expenseId' in subject) {
    const woId = await linkedWorkOrderId(db, subject.expenseId);
    if (woId && (await rowsOf(db, { workOrderId: woId })).length > 0) return [];
  }
  const existing = await rowsOf(db, subject);
  const asked = existing.reduce((m, r) => Math.max(m, r.amountFils), 0);
  if (existing.length > 0 && asked >= amountFils) return [];

  const shares = await ownerSharesFor(db, {
    buildingId: facts.buildingId,
    unitId: facts.unitId,
    date: facts.date,
    amountFils,
    method: facts.method,
  });
  const where = subjectAudit(subject);
  if (existing.length > 0) {
    await db.delete(repairApprovals).where(subjectCondition(subject));
    await audit(db, actor, {
      action: 'repair_approval.reask',
      ...where,
      before: existing,
      after: { amountFils, previousAmountFils: asked },
    });
  }
  if (shares.size === 0) return [];
  const inserted = await db
    .insert(repairApprovals)
    .values(
      [...shares].map(([ownerId, shareFils]) => ({
        ...('workOrderId' in subject
          ? { workOrderId: subject.workOrderId }
          : { expenseId: subject.expenseId }),
        ownerId,
        amountFils,
        shareFils,
        askedOn: today,
      })),
    )
    .returning();
  await audit(db, actor, {
    action: 'repair_approval.request',
    ...where,
    after: {
      amountFils,
      askedOn: today,
      owners: inserted.map((r) => ({
        approvalId: r.id,
        ownerId: r.ownerId,
        shareFils: r.shareFils,
      })),
    },
  });
  return inserted.map((r) => r.id);
}

// The gate ----------------------------------------------------------------------------------------

/** The answers that decide whether the subject may go ahead (an expense falls back to its job's). */
async function gateRows(
  db: Dbx,
  subject: ApprovalSubject,
): Promise<{ subject: ApprovalSubject; rows: ApprovalRow[] }> {
  const own = await rowsOf(db, subject);
  if (own.length > 0 || 'workOrderId' in subject) return { subject, rows: own };
  const woId = await linkedWorkOrderId(db, subject.expenseId);
  if (!woId) return { subject, rows: own };
  const job = { workOrderId: woId };
  return { subject: job, rows: await rowsOf(db, job) };
}

/** 409 `approval_required` while any owner's answer is pending or rejected (and not overridden). */
export async function assertApprovalsAllow(db: Dbx, subject: ApprovalSubject): Promise<void> {
  const { rows } = await gateRows(db, subject);
  if (!approvalsBlock(rows)) return;
  const blocking = rows.filter(isBlockingApproval);
  const rejected = blocking.filter((r) => r.status === 'rejected').length;
  throw new ApiError(
    409,
    'approval_required',
    rejected > 0
      ? 'An owner rejected this job; an admin can override with a reason'
      : 'Waiting for the owners to approve this job; an admin can override with a reason',
    { pending: blocking.length - rejected, rejected },
  );
}

/** Admin: let the job go ahead over the pending and rejected answers. The reason is audited. */
export async function overrideApprovals(
  db: Dbx,
  actor: AuditActor,
  subject: ApprovalSubject,
  reason: string,
): Promise<ApprovalRow[]> {
  const exists =
    'workOrderId' in subject
      ? await db.query.workOrders.findFirst({
          where: eq(workOrders.id, subject.workOrderId),
          columns: { id: true },
        })
      : await db.query.expenses.findFirst({
          where: eq(expenses.id, subject.expenseId),
          columns: { id: true },
        });
  if (!exists) throw notFound('workOrderId' in subject ? 'Work order' : 'Expense');
  const gate = await gateRows(db, subject);
  const blocking = gate.rows.filter(isBlockingApproval);
  if (blocking.length === 0) throw conflict('No owner answer is holding this job back');
  const updated = await db
    .update(repairApprovals)
    .set({
      overriddenAt: new Date(),
      overriddenBy: actor.type === 'staff' ? actor.id : null,
      overrideReason: reason,
    })
    .where(
      inArray(
        repairApprovals.id,
        blocking.map((r) => r.id),
      ),
    )
    .returning();
  await audit(db, actor, {
    action: 'repair_approval.override',
    ...subjectAudit(gate.subject),
    before: blocking,
    after: { reason, approvalIds: updated.map((r) => r.id) },
  });
  return updated;
}

// Staff views -------------------------------------------------------------------------------------

export interface StaffApproval {
  id: string;
  ownerId: string;
  nameAr: string;
  nameEn: string;
  amountFils: number;
  shareFils: number;
  status: RepairApprovalStatus;
  note: string | null;
  askedOn: string;
  answeredAt: Date | null;
  /** The day silence counts as approval, or null when silent approval is off. */
  deadline: PlainDate | null;
  overriddenAt: Date | null;
  overriddenByName: string | null;
  overrideReason: string | null;
}

/** Per-owner answers for the work order or expense detail page (an expense shows its job's). */
export async function staffApprovals(
  db: Dbx,
  subject: ApprovalSubject,
  silenceDays: number,
): Promise<{
  source: 'work_order' | 'expense' | null;
  state: ReturnType<typeof approvalState>;
  items: StaffApproval[];
}> {
  const gate = await gateRows(db, subject);
  if (gate.rows.length === 0) return { source: null, state: 'none', items: [] };
  const rows = await db
    .select({
      id: repairApprovals.id,
      ownerId: repairApprovals.ownerId,
      nameAr: owners.nameAr,
      nameEn: owners.nameEn,
      amountFils: repairApprovals.amountFils,
      shareFils: repairApprovals.shareFils,
      status: repairApprovals.status,
      note: repairApprovals.note,
      askedOn: repairApprovals.askedOn,
      answeredAt: repairApprovals.answeredAt,
      overriddenAt: repairApprovals.overriddenAt,
      overriddenByName: staffUsers.name,
      overrideReason: repairApprovals.overrideReason,
    })
    .from(repairApprovals)
    .innerJoin(owners, eq(owners.id, repairApprovals.ownerId))
    .leftJoin(staffUsers, eq(staffUsers.id, repairApprovals.overriddenBy))
    .where(subjectCondition(gate.subject))
    .orderBy(asc(owners.nameEn));
  return {
    source: 'workOrderId' in gate.subject ? 'work_order' : 'expense',
    state: approvalState(gate.rows),
    items: rows.map((r) => ({
      ...r,
      deadline:
        r.status === 'pending' ? silenceDeadline(r.askedOn as PlainDate, silenceDays) : null,
    })),
  };
}

/**
 * SQL for the one-word state of a job's approvals (the same rule as approvalState in shared), for
 * the staff lists. `column` is the work order or expense id the rows point at.
 */
export function approvalStateSql(kind: 'work_order' | 'expense', idColumn: AnyPgColumn): SQL {
  const fk = kind === 'work_order' ? sql`a.work_order_id` : sql`a.expense_id`;
  return sql`(select case
      when count(*) = 0 then 'none'
      when bool_or(a.status = 'rejected' and a.overridden_at is null) then 'rejected'
      when bool_or(a.status = 'pending' and a.overridden_at is null) then 'pending'
      when bool_or(a.overridden_at is not null and a.status <> 'approved') then 'overridden'
      else 'approved' end
    from ${repairApprovals} a where ${fk} = ${idColumn})`;
}

/** List filter `approval=awaiting`: still waiting to start and held back by an owner's answer. */
export function awaitingApprovalSql(kind: 'work_order' | 'expense', idColumn: AnyPgColumn): SQL {
  const fk = kind === 'work_order' ? sql`a.work_order_id` : sql`a.expense_id`;
  return sql`exists (select 1 from ${repairApprovals} a where ${fk} = ${idColumn}
    and a.status in ('pending', 'rejected') and a.overridden_at is null)`;
}

// Owners ------------------------------------------------------------------------------------------

const ownerApprovalSelect = {
  id: repairApprovals.id,
  status: repairApprovals.status,
  note: repairApprovals.note,
  askedOn: repairApprovals.askedOn,
  answeredAt: repairApprovals.answeredAt,
  amountFils: repairApprovals.amountFils,
  shareFils: repairApprovals.shareFils,
  workOrderId: repairApprovals.workOrderId,
  expenseId: repairApprovals.expenseId,
  woTitleAr: workOrders.titleAr,
  woTitleEn: workOrders.titleEn,
  woDescription: workOrders.description,
  woStatus: workOrders.status,
  xReasonAr: expenses.reasonAr,
  xReasonEn: expenses.reasonEn,
  xStatus: expenses.status,
  buildingNameAr: buildings.nameAr,
  buildingNameEn: buildings.nameEn,
  unitNo: units.unitNo,
  vendorName: vendors.name,
};

function ownerApprovalQuery(db: Dbx) {
  return db
    .select(ownerApprovalSelect)
    .from(repairApprovals)
    .leftJoin(workOrders, eq(workOrders.id, repairApprovals.workOrderId))
    .leftJoin(expenses, eq(expenses.id, repairApprovals.expenseId))
    .innerJoin(
      buildings,
      sql`${buildings.id} = coalesce(${workOrders.buildingId}, ${expenses.buildingId})`,
    )
    .leftJoin(units, sql`${units.id} = coalesce(${workOrders.unitId}, ${expenses.unitId})`)
    .leftJoin(vendors, sql`${vendors.id} = coalesce(${workOrders.vendorId}, ${expenses.vendorId})`);
}

export interface OwnerApprovalItem {
  id: string;
  kind: 'work_order' | 'expense';
  workOrderId: string | null;
  expenseId: string | null;
  titleAr: string;
  titleEn: string;
  buildingNameAr: string;
  buildingNameEn: string;
  unitNo: string | null;
  vendorName: string | null;
  amountFils: number;
  shareFils: number;
  status: RepairApprovalStatus;
  note: string | null;
  askedOn: string;
  answeredAt: Date | null;
  deadline: PlainDate | null;
  /** The job has not started (or the expense been posted): an answer still matters. */
  waiting: boolean;
  /** Pending and still waiting: the app shows Approve and Reject. */
  canAnswer: boolean;
}

type OwnerApprovalRaw = Awaited<ReturnType<typeof ownerApprovalQuery>>[number];

function toOwnerItem(r: OwnerApprovalRaw, silenceDays: number): OwnerApprovalItem {
  const kind = r.workOrderId ? 'work_order' : 'expense';
  const waiting =
    kind === 'work_order'
      ? r.woStatus !== null && APPROVAL_ASKABLE_WORK_ORDER_STATUSES.includes(r.woStatus)
      : r.xStatus === 'draft';
  return {
    id: r.id,
    kind,
    workOrderId: r.workOrderId,
    expenseId: r.expenseId,
    titleAr: (kind === 'work_order' ? r.woTitleAr : r.xReasonAr) ?? '',
    titleEn: (kind === 'work_order' ? r.woTitleEn : r.xReasonEn) ?? '',
    buildingNameAr: r.buildingNameAr,
    buildingNameEn: r.buildingNameEn,
    unitNo: r.unitNo,
    vendorName: r.vendorName,
    amountFils: r.amountFils,
    shareFils: r.shareFils,
    status: r.status,
    note: r.note,
    askedOn: r.askedOn,
    answeredAt: r.answeredAt,
    deadline:
      r.status === 'pending' && waiting
        ? silenceDeadline(r.askedOn as PlainDate, silenceDays)
        : null,
    waiting,
    canAnswer: r.status === 'pending' && waiting,
  };
}

/** The owner's own requests, those still waiting for an answer first, newest first. */
export async function ownerApprovals(
  db: Dbx,
  ownerId: string,
  q: { status?: RepairApprovalStatus | undefined; workOrderId?: string | undefined },
  silenceDays: number,
): Promise<OwnerApprovalItem[]> {
  const conditions: SQL[] = [eq(repairApprovals.ownerId, ownerId)];
  if (q.status) conditions.push(eq(repairApprovals.status, q.status));
  if (q.workOrderId) conditions.push(eq(repairApprovals.workOrderId, q.workOrderId));
  const rows = await ownerApprovalQuery(db)
    .where(and(...conditions))
    .orderBy(
      desc(sql`${repairApprovals.status} = 'pending'`),
      desc(repairApprovals.askedOn),
      desc(repairApprovals.id),
    )
    .limit(200);
  return rows.map((r) => toOwnerItem(r, silenceDays));
}

/** One request with what the owner needs to decide: the reason, the vendor and the photos. */
export async function ownerApprovalDetail(
  db: Dbx,
  ownerId: string,
  id: string,
  silenceDays: number,
) {
  // Another owner's request is a 404, never a 403: its existence is not disclosed.
  const [row] = await ownerApprovalQuery(db).where(
    and(eq(repairApprovals.id, id), eq(repairApprovals.ownerId, ownerId)),
  );
  if (!row) throw notFound('Approval');
  const item = toOwnerItem(row, silenceDays);
  // The table's check constraint guarantees exactly one of the two.
  const entityId = item.workOrderId ?? item.expenseId ?? '';
  // Read here rather than through attachments.ts, which imports this module for its owner check.
  const attachments = await db
    .select({
      id: schema.attachments.id,
      fileName: schema.attachments.fileName,
      mime: schema.attachments.mime,
      sizeBytes: schema.attachments.sizeBytes,
    })
    .from(schema.attachments)
    .where(
      and(eq(schema.attachments.entityType, item.kind), eq(schema.attachments.entityId, entityId)),
    )
    .orderBy(schema.attachments.createdAt);
  return {
    ...item,
    description: item.kind === 'work_order' ? (row.woDescription ?? '') : '',
    attachments,
  };
}

/** The owner approves or rejects; only a pending request on a job that has not started. */
export async function answerApproval(
  db: Dbx,
  actor: AuditActor,
  ownerId: string,
  id: string,
  input: AnswerApprovalInput,
  silenceDays: number,
) {
  const before = await ownerApprovalDetail(db, ownerId, id, silenceDays);
  if (before.status !== 'pending') throw conflict('This request has already been answered');
  if (!before.waiting) throw conflict('This job is no longer waiting for an answer');
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  const [after] = await db
    .update(repairApprovals)
    .set({ status, note: input.note, answeredAt: new Date() })
    // The status in the WHERE makes a double tap answer once.
    .where(and(eq(repairApprovals.id, id), eq(repairApprovals.status, 'pending')))
    .returning();
  if (!after) throw conflict('This request has already been answered');
  await audit(db, actor, {
    action: 'repair_approval.answer',
    entityType: 'repair_approval',
    entityId: id,
    before: { status: before.status },
    after: {
      status,
      note: input.note,
      workOrderId: after.workOrderId,
      expenseId: after.expenseId,
    },
  });
  return ownerApprovalDetail(db, ownerId, id, silenceDays);
}

/** Whether an attachment of a work order or expense belongs to a request this owner received. */
export async function approvalAttachmentInOwnerScope(
  db: Dbx,
  ownerId: string,
  entityType: 'work_order' | 'expense',
  entityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: repairApprovals.id })
    .from(repairApprovals)
    .where(
      and(
        eq(repairApprovals.ownerId, ownerId),
        entityType === 'work_order'
          ? eq(repairApprovals.workOrderId, entityId)
          : eq(repairApprovals.expenseId, entityId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// The daily job -------------------------------------------------------------------------------------

export interface SilentApproval {
  id: string;
  ownerId: string;
  workOrderId: string | null;
  expenseId: string | null;
}

/**
 * Pending answers asked `silenceDays` or more days ago, on jobs still waiting, become "approved by
 * silence", each with its audit row. Staff see them on the Today panel and the detail pages.
 */
export async function approveBySilence(
  db: Dbx,
  today: PlainDate,
  silenceDays: number,
): Promise<SilentApproval[]> {
  const cutoff = silenceCutoff(silenceDays, today);
  if (cutoff === null) return [];
  const due = await db
    .select({ id: repairApprovals.id })
    .from(repairApprovals)
    .leftJoin(workOrders, eq(workOrders.id, repairApprovals.workOrderId))
    .leftJoin(expenses, eq(expenses.id, repairApprovals.expenseId))
    .where(
      and(
        eq(repairApprovals.status, 'pending'),
        lte(repairApprovals.askedOn, cutoff),
        sql`(${workOrders.status} in ('open', 'scheduled') or ${expenses.status} = 'draft')`,
      ),
    );
  if (due.length === 0) return [];
  const updated = await db
    .update(repairApprovals)
    .set({ status: 'approved_by_silence', answeredAt: new Date() })
    .where(
      and(
        inArray(
          repairApprovals.id,
          due.map((d) => d.id),
        ),
        eq(repairApprovals.status, 'pending'),
      ),
    )
    .returning({
      id: repairApprovals.id,
      ownerId: repairApprovals.ownerId,
      workOrderId: repairApprovals.workOrderId,
      expenseId: repairApprovals.expenseId,
      askedOn: repairApprovals.askedOn,
    });
  const system: AuditActor = { type: 'system', id: null, ip: null, userAgent: null };
  for (const r of updated) {
    await audit(db, system, {
      action: 'repair_approval.silence',
      entityType: 'repair_approval',
      entityId: r.id,
      before: { status: 'pending' },
      after: {
        status: 'approved_by_silence',
        askedOn: r.askedOn,
        silenceDays,
        workOrderId: r.workOrderId,
        expenseId: r.expenseId,
      },
    });
  }
  return updated.map(({ askedOn: _a, ...r }) => r);
}
