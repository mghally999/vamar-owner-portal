import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  addDays,
  generateChequeSchedule,
  validateChequeGrid,
  type ChequeGridRowInput,
  type ContractStatus,
  type CreateContractInput,
  type PlainDate,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import { ApiError, conflict, notFound, validation } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { decodeCursor, page } from '../util/pagination.js';

const { contracts, cheques, chequeEvents, units, buildings, tenants } = schema;

export interface ContractListQuery {
  status?: ContractStatus | undefined;
  buildingId?: string | undefined;
  unitId?: string | undefined;
  endingWithinDays?: number | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function listContracts(db: Dbx, q: ContractListQuery, todayDate: PlainDate) {
  const cursor = decodeCursor(q.cursor);
  const conditions = [];
  if (q.status) conditions.push(eq(contracts.status, q.status));
  if (q.unitId) conditions.push(eq(contracts.unitId, q.unitId));
  if (q.buildingId) conditions.push(eq(units.buildingId, q.buildingId));
  if (q.endingWithinDays !== undefined) {
    conditions.push(eq(contracts.status, 'active'));
    conditions.push(
      sql`${contracts.endDate} between ${todayDate} and ${addDays(todayDate, q.endingWithinDays)}`,
    );
  }
  if (cursor) {
    conditions.push(
      or(
        lt(contracts.createdAt, new Date(cursor.key)),
        and(eq(contracts.createdAt, new Date(cursor.key)), lt(contracts.id, cursor.id)),
      ),
    );
  }
  const rows = await db
    .select({
      id: contracts.id,
      unitId: contracts.unitId,
      unitNo: units.unitNo,
      buildingId: buildings.id,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantId: tenants.id,
      tenantName: tenants.name,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      annualRentFils: contracts.annualRentFils,
      chequeCount: contracts.chequeCount,
      status: contracts.status,
      createdAt: contracts.createdAt,
    })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contracts.createdAt), desc(contracts.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.createdAt.toISOString(), id: r.id }));
}

export async function getContractDetail(db: Dbx, id: string) {
  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!contract) throw notFound('Contract');
  const unit = await db.query.units.findFirst({ where: eq(units.id, contract.unitId) });
  const building = unit
    ? await db.query.buildings.findFirst({ where: eq(buildings.id, unit.buildingId) })
    : null;
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, contract.tenantId) });
  const grid = await db
    .select()
    .from(cheques)
    .where(eq(cheques.contractId, id))
    .orderBy(asc(cheques.seq));
  const gridValidation = validateChequeGrid(
    grid.map((c) => ({
      seq: c.seq,
      dueDate: c.dueDate as PlainDate,
      amountFils: c.amountFils,
      chequeNo: c.chequeNo,
      bankName: c.bankName,
    })),
    contract.annualRentFils,
  );
  return { ...contract, unit, building, tenant, cheques: grid, gridValidation };
}

/** Create a draft contract and its cheque rows (dates generated unless a grid was supplied). */
export async function createContract(db: Dbx, actor: AuditActor, input: CreateContractInput) {
  const unit = await db.query.units.findFirst({
    where: eq(units.id, input.unitId),
    columns: { id: true },
  });
  if (!unit) throw notFound('Unit');
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, input.tenantId),
    columns: { id: true },
  });
  if (!tenant) throw notFound('Tenant');

  const [contract] = await db
    .insert(contracts)
    .values({
      unitId: input.unitId,
      tenantId: input.tenantId,
      startDate: input.startDate,
      endDate: input.endDate,
      annualRentFils: input.annualRentFils,
      chequeCount: input.chequeCount,
      status: 'draft',
      ejariNo: input.ejariNo,
      notes: input.notes,
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!contract) throw new Error('insert failed');

  const rows: ChequeGridRowInput[] =
    input.cheques ??
    generateChequeSchedule({
      startDate: input.startDate,
      endDate: input.endDate,
      chequeCount: input.chequeCount,
    }).map((s) => ({
      seq: s.seq,
      dueDate: s.dueDate,
      amountFils: null,
      chequeNo: null,
      bankName: null,
    }));
  const inserted = await db
    .insert(cheques)
    .values(
      rows.map((r) => ({
        contractId: contract.id,
        seq: r.seq,
        dueDate: r.dueDate,
        amountFils: r.amountFils,
        chequeNo: r.chequeNo,
        bankName: r.bankName,
        status: 'upcoming' as const,
      })),
    )
    .returning();
  await audit(db, actor, {
    action: 'contract.create',
    entityType: 'contract',
    entityId: contract.id,
    after: { contract, cheques: inserted },
  });
  return { ...contract, cheques: inserted };
}

export interface ContractPatch {
  tenantId?: string | undefined;
  startDate?: PlainDate | undefined;
  endDate?: PlainDate | undefined;
  annualRentFils?: number | undefined;
  ejariNo?: string | null | undefined;
  notes?: string | undefined;
  cheques?: ChequeGridRowInput[] | undefined;
}

/** Edit a draft (terms and the whole grid). Active contracts allow notes/ejari and grid edits of unpaid rows only. */
export async function updateContract(db: Dbx, actor: AuditActor, id: string, patch: ContractPatch) {
  const before = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!before) throw notFound('Contract');
  const isDraft = before.status === 'draft';
  if (!isDraft && (patch.tenantId || patch.startDate || patch.endDate || patch.annualRentFils)) {
    throw conflict('Only draft contracts can change tenant, dates or rent');
  }
  const { cheques: gridPatch, ...fields } = patch;
  const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const [after] = Object.keys(cleanFields).length
    ? await db.update(contracts).set(cleanFields).where(eq(contracts.id, id)).returning()
    : [before];

  let gridBefore: (typeof cheques.$inferSelect)[] | undefined;
  let gridAfter: (typeof cheques.$inferSelect)[] | undefined;
  if (gridPatch) {
    gridBefore = await db
      .select()
      .from(cheques)
      .where(eq(cheques.contractId, id))
      .orderBy(asc(cheques.seq));
    const expectedCount = after?.chequeCount ?? before.chequeCount;
    if (gridPatch.length !== expectedCount)
      throw validation(`Grid must have exactly ${expectedCount} rows`);
    for (const row of gridPatch) {
      const existing = gridBefore.find((c) => c.seq === row.seq);
      if (!existing) throw validation(`Unknown cheque seq ${row.seq}`);
      if (!isDraft && existing.status !== 'upcoming') continue; // paid/deposited rows are locked
      await db
        .update(cheques)
        .set({
          dueDate: row.dueDate,
          amountFils: row.amountFils,
          chequeNo: row.chequeNo,
          bankName: row.bankName,
        })
        .where(eq(cheques.id, existing.id));
    }
    gridAfter = await db
      .select()
      .from(cheques)
      .where(eq(cheques.contractId, id))
      .orderBy(asc(cheques.seq));
  }
  await audit(db, actor, {
    action: 'contract.update',
    entityType: 'contract',
    entityId: id,
    before: { contract: before, cheques: gridBefore },
    after: { contract: after, cheques: gridAfter },
  });
  return after;
}

/**
 * Draft -> active. Every amount, cheque number and bank must be filled. If the grid total differs
 * from the annual rent the staff member must have confirmed with a reason (audited). If the
 * contract renews an older one, that one becomes `renewed`.
 */
export async function activateContract(
  db: Dbx,
  actor: AuditActor,
  id: string,
  totalMismatchReason?: string,
) {
  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!contract) throw notFound('Contract');
  if (contract.status !== 'draft') throw conflict('Only draft contracts can be activated');
  const grid = await db
    .select()
    .from(cheques)
    .where(eq(cheques.contractId, id))
    .orderBy(asc(cheques.seq));
  const v = validateChequeGrid(
    grid.map((c) => ({
      seq: c.seq,
      dueDate: c.dueDate as PlainDate,
      amountFils: c.amountFils,
      chequeNo: c.chequeNo,
      bankName: c.bankName,
    })),
    contract.annualRentFils,
  );
  if (!v.complete)
    throw new ApiError(422, 'grid_incomplete', 'Every cheque needs an amount, number and bank', v);
  if (!v.matchesRent && !totalMismatchReason) {
    throw new ApiError(
      422,
      'total_mismatch_needs_reason',
      'Cheque total differs from the annual rent; confirm with a reason',
      v,
    );
  }
  // One active contract per unit at a time (overlapping dates).
  const overlap = await db.query.contracts.findFirst({
    where: and(
      eq(contracts.unitId, contract.unitId),
      eq(contracts.status, 'active'),
      sql`${contracts.startDate} <= ${contract.endDate} and ${contracts.endDate} >= ${contract.startDate}`,
    ),
    columns: { id: true },
  });
  if (overlap && overlap.id !== contract.previousContractId) {
    throw conflict('The unit already has an active contract overlapping these dates');
  }

  const [after] = await db
    .update(contracts)
    .set({ status: 'active' })
    .where(eq(contracts.id, id))
    .returning();
  // Timeline: every cheque starts its life as upcoming at activation.
  await db
    .insert(chequeEvents)
    .values(
      grid.map((c) => ({
        chequeId: c.id,
        fromStatus: null,
        toStatus: 'upcoming' as const,
        note: '',
        actorStaffId: actor.type === 'staff' ? actor.id : null,
      })),
    );
  if (contract.previousContractId) {
    await db
      .update(contracts)
      .set({ status: 'renewed' })
      .where(
        and(
          eq(contracts.id, contract.previousContractId),
          inArray(contracts.status, ['active', 'expired']),
        ),
      );
  }
  await audit(db, actor, {
    action: 'contract.activate',
    entityType: 'contract',
    entityId: id,
    before: contract,
    after: {
      ...after,
      totalMismatchReason: totalMismatchReason ?? null,
      gridTotalFils: v.totalFils,
    },
  });
  return after;
}

export async function terminateContract(db: Dbx, actor: AuditActor, id: string, reason: string) {
  const before = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!before) throw notFound('Contract');
  if (before.status !== 'active') throw conflict('Only active contracts can be terminated');
  const [after] = await db
    .update(contracts)
    .set({ status: 'terminated' })
    .where(eq(contracts.id, id))
    .returning();
  // Cancel cheques that have not been deposited yet.
  const cancelled = await db
    .update(cheques)
    .set({ status: 'cancelled', statusChangedAt: new Date() })
    .where(and(eq(cheques.contractId, id), eq(cheques.status, 'upcoming')))
    .returning({ id: cheques.id });
  if (cancelled.length) {
    await db
      .insert(chequeEvents)
      .values(
        cancelled.map((c) => ({
          chequeId: c.id,
          fromStatus: 'upcoming' as const,
          toStatus: 'cancelled' as const,
          note: `Contract terminated: ${reason}`,
          actorStaffId: actor.type === 'staff' ? actor.id : null,
        })),
      );
  }
  await audit(db, actor, {
    action: 'contract.terminate',
    entityType: 'contract',
    entityId: id,
    before,
    after: { ...after, reason },
  });
  return after;
}

/**
 * One-click renewal: a new draft starting the day after the old one ends, same unit, tenant,
 * rent and cheque count, schedule regenerated with empty amounts. Old contract stays active
 * until the new one is activated (then it becomes `renewed`).
 */
export async function renewContract(db: Dbx, actor: AuditActor, id: string) {
  const old = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!old) throw notFound('Contract');
  if (old.status !== 'active' && old.status !== 'expired')
    throw conflict('Only active or expired contracts can be renewed');
  const existing = await db.query.contracts.findFirst({
    where: and(eq(contracts.previousContractId, id), eq(contracts.status, 'draft')),
    columns: { id: true },
  });
  if (existing) throw conflict('A renewal draft already exists for this contract');
  const startDate = addDays(old.endDate as PlainDate, 1);
  const endDate = addDays(addDaysMonths(startDate, 12), -1);
  const created = await createContract(db, actor, {
    unitId: old.unitId,
    tenantId: old.tenantId,
    startDate,
    endDate,
    annualRentFils: old.annualRentFils,
    chequeCount: old.chequeCount,
    ejariNo: null,
    notes: '',
  });
  const [linked] = await db
    .update(contracts)
    .set({ previousContractId: id })
    .where(eq(contracts.id, created.id))
    .returning();
  await audit(db, actor, {
    action: 'contract.renew',
    entityType: 'contract',
    entityId: id,
    after: { newContractId: created.id },
  });
  return { ...created, ...linked };
}

function addDaysMonths(date: PlainDate, months: number): PlainDate {
  // local import to keep the dependency explicit
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const idx = y * 12 + (m - 1) + months;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  const dim = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, dim);
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}` as PlainDate;
}
