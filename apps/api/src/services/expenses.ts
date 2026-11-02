/**
 * Expenses: categories and vendors, the draft -> posted -> void life cycle, the allocation of a
 * posted expense to the owners (written once, never rewritten), recurring rules and the owner's
 * own list. Every staff write runs inside the caller's transaction with its audit row.
 */
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  allocateExpense,
  defaultAllocationMethod,
  expenseTotal,
  isExpenseOutlier,
  isLargeExpense,
  ownersOnDate,
  recurringDueDates,
  resolvePeriodQuery,
  vatFor,
  type AllocationMethod,
  type AllocationUnit,
  type CreateExpenseCategoryInput,
  type CreateExpenseInput,
  type CreateRecurringRuleInput,
  type CreateVendorInput,
  type ExpenseKind,
  type ExpenseStatus,
  type Period,
  type PlainDate,
  type UpdateExpenseInput,
  type WeekStart,
} from '@vamar/shared';
import { orSql, type Dbx } from '../db.js';
import { ApiError, conflict, notFound, validation } from '../errors.js';
import type { Patch } from '../util/types.js';
import { decodeCursor, page } from '../util/pagination.js';
import { listAttachments } from './attachments.js';
import { audit, type AuditActor } from './audit.js';

const {
  expenses,
  expenseAllocations,
  expenseCategories,
  vendors,
  recurringExpenseRules,
  units,
  buildings,
  unitOwnerships,
  owners,
  workOrders,
  disputes,
  staffUsers,
} = schema;

function clean<T extends object>(patch: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/** `from`/`to` or a preset when the client sent one; otherwise no date filter at all. */
export function optionalPeriod(
  q: { preset?: string | undefined; from?: string | undefined; to?: string | undefined },
  today: PlainDate,
  weekStart?: WeekStart,
): Period | null {
  if (q.preset === undefined && (q.from === undefined || q.to === undefined)) return null;
  return resolvePeriodQuery(q, today, { weekStart }).period;
}

// Categories ---------------------------------------------------------------------------------------

export async function listCategories(db: Dbx, includeInactive = false) {
  return db
    .select()
    .from(expenseCategories)
    .where(includeInactive ? undefined : eq(expenseCategories.active, true))
    .orderBy(
      asc(expenseCategories.kind),
      asc(expenseCategories.sort),
      asc(expenseCategories.nameEn),
    );
}

export async function createCategory(
  db: Dbx,
  actor: AuditActor,
  input: CreateExpenseCategoryInput,
) {
  if (input.parentId) {
    const parent = await db.query.expenseCategories.findFirst({
      where: eq(expenseCategories.id, input.parentId),
      columns: { id: true, kind: true },
    });
    if (!parent) throw notFound('Category');
    if (parent.kind !== input.kind) throw validation('A subcategory has the kind of its parent');
  }
  const [row] = await db.insert(expenseCategories).values(input).returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'expense_category.create',
    entityType: 'expense_category',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateCategory(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateExpenseCategoryInput>,
) {
  const before = await db.query.expenseCategories.findFirst({
    where: eq(expenseCategories.id, id),
  });
  if (!before) throw notFound('Category');
  if (patch.parentId === id) throw validation('A category cannot be its own parent');
  const [after] = await db
    .update(expenseCategories)
    .set(clean(patch))
    .where(eq(expenseCategories.id, id))
    .returning();
  await audit(db, actor, {
    action: 'expense_category.update',
    entityType: 'expense_category',
    entityId: id,
    before,
    after,
  });
  return after;
}

// Vendors ------------------------------------------------------------------------------------------

export async function listVendors(
  db: Dbx,
  q: { search?: string | undefined; includeInactive?: boolean },
) {
  const conditions: SQL[] = [];
  if (!q.includeInactive) conditions.push(eq(vendors.active, true));
  if (q.search) conditions.push(sql`${vendors.name} ilike ${'%' + q.search + '%'}`);
  return db
    .select()
    .from(vendors)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(vendors.name))
    .limit(200);
}

export async function createVendor(db: Dbx, actor: AuditActor, input: CreateVendorInput) {
  const [row] = await db.insert(vendors).values(input).returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'vendor.create',
    entityType: 'vendor',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateVendor(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateVendorInput>,
) {
  const before = await db.query.vendors.findFirst({ where: eq(vendors.id, id) });
  if (!before) throw notFound('Vendor');
  const [after] = await db.update(vendors).set(clean(patch)).where(eq(vendors.id, id)).returning();
  await audit(db, actor, {
    action: 'vendor.update',
    entityType: 'vendor',
    entityId: id,
    before,
    after,
  });
  return after;
}

// Allocation ---------------------------------------------------------------------------------------

/**
 * The units an expense is spread over and the owners holding each one on `date`. A unit nobody
 * held on that date (an invoice dated before its first owner) falls back to its current owners.
 */
export async function allocationUnitsFor(
  db: Dbx,
  scope: 'building' | 'unit',
  buildingId: string,
  unitId: string | null,
  date: PlainDate,
): Promise<AllocationUnit[]> {
  const unitRows = await db
    .select({ id: units.id, sizeSqft: units.sizeSqft, buildingId: units.buildingId })
    .from(units)
    .where(
      scope === 'unit' && unitId !== null
        ? eq(units.id, unitId)
        : and(eq(units.buildingId, buildingId), eq(units.active, true)),
    );
  if (scope === 'unit' && (unitRows.length !== 1 || unitRows[0]?.buildingId !== buildingId))
    throw notFound('Unit');
  if (unitRows.length === 0) throw validation('The building has no active units');
  const rows = await db
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
  const typed = rows.map((r) => ({
    ...r,
    fromDate: r.fromDate as PlainDate,
    toDate: r.toDate as PlainDate | null,
  }));
  return unitRows.map((u) => {
    let holders = ownersOnDate(typed, u.id, date);
    if (holders.length === 0)
      holders = typed
        .filter((r) => r.unitId === u.id && r.toDate === null)
        .map((r) => ({ ownerId: r.ownerId, shareBp: r.shareBp }));
    if (holders.length === 0)
      throw new ApiError(422, 'validation', 'A unit of this expense has no owners', {
        unitId: u.id,
      });
    return { unitId: u.id, sizeSqft: u.sizeSqft, owners: holders };
  });
}

export function resolveMethod(
  scope: 'building' | 'unit',
  requested: AllocationMethod | undefined,
  allocationUnits: readonly AllocationUnit[],
): AllocationMethod {
  if (scope === 'unit') return 'single_unit';
  if (requested !== undefined) return requested;
  return defaultAllocationMethod(allocationUnits);
}

export interface AllocationPreviewRow {
  unitId: string;
  unitNo: string;
  ownerId: string;
  nameAr: string;
  nameEn: string;
  shareBp: number;
  amountFils: number;
}

export async function previewAllocation(
  db: Dbx,
  input: {
    scope: 'building' | 'unit';
    buildingId: string;
    unitId: string | null;
    invoiceDate: PlainDate;
    totalFils: number;
    allocationMethod?: AllocationMethod | undefined;
  },
): Promise<{ method: AllocationMethod; items: AllocationPreviewRow[] }> {
  const allocationUnits = await allocationUnitsFor(
    db,
    input.scope,
    input.buildingId,
    input.unitId,
    input.invoiceDate,
  );
  const method = resolveMethod(input.scope, input.allocationMethod, allocationUnits);
  let parts;
  try {
    parts = allocateExpense(input.totalFils, method, allocationUnits);
  } catch (e) {
    throw validation(e instanceof Error ? e.message : 'Cannot allocate');
  }
  const unitIds = [...new Set(parts.map((p) => p.unitId))];
  const ownerIds = [...new Set(parts.map((p) => p.ownerId))];
  const [unitRows, ownerRows] = await Promise.all([
    db.select({ id: units.id, unitNo: units.unitNo }).from(units).where(inArray(units.id, unitIds)),
    db
      .select({ id: owners.id, nameAr: owners.nameAr, nameEn: owners.nameEn })
      .from(owners)
      .where(inArray(owners.id, ownerIds)),
  ]);
  const items = parts.map((p) => {
    const unit = allocationUnits.find((u) => u.unitId === p.unitId);
    const owner = ownerRows.find((o) => o.id === p.ownerId);
    return {
      unitId: p.unitId,
      unitNo: unitRows.find((u) => u.id === p.unitId)?.unitNo ?? '',
      ownerId: p.ownerId,
      nameAr: owner?.nameAr ?? '',
      nameEn: owner?.nameEn ?? '',
      shareBp: unit?.owners.find((o) => o.ownerId === p.ownerId)?.shareBp ?? 0,
      amountFils: p.amountFils,
    };
  });
  return { method, items };
}

// Staff list and detail ----------------------------------------------------------------------------

export interface ExpenseListQuery {
  buildingId?: string | undefined;
  unitId?: string | undefined;
  categoryId?: string | undefined;
  vendorId?: string | undefined;
  kind?: ExpenseKind | undefined;
  status?: ExpenseStatus | undefined;
  search?: string | undefined;
  recurringRuleId?: string | undefined;
  disputeId?: string | undefined;
  period?: Period | null | undefined;
  cursor?: string | undefined;
  limit: number;
}

const expenseListSelect = {
  id: expenses.id,
  scope: expenses.scope,
  buildingId: expenses.buildingId,
  buildingNameAr: buildings.nameAr,
  buildingNameEn: buildings.nameEn,
  unitId: expenses.unitId,
  unitNo: units.unitNo,
  categoryId: expenses.categoryId,
  categoryNameAr: expenseCategories.nameAr,
  categoryNameEn: expenseCategories.nameEn,
  kind: expenses.kind,
  vendorId: expenses.vendorId,
  vendorName: vendors.name,
  reasonAr: expenses.reasonAr,
  reasonEn: expenses.reasonEn,
  invoiceNo: expenses.invoiceNo,
  invoiceDate: expenses.invoiceDate,
  coversFrom: expenses.coversFrom,
  coversTo: expenses.coversTo,
  amountFils: expenses.amountFils,
  vatFils: expenses.vatFils,
  totalFils: expenses.totalFils,
  paidOn: expenses.paidOn,
  paymentMethod: expenses.paymentMethod,
  status: expenses.status,
  allocationMethod: expenses.allocationMethod,
  visibleToOwner: expenses.visibleToOwner,
  recurringRuleId: expenses.recurringRuleId,
  disputeId: expenses.disputeId,
  correctsExpenseId: expenses.correctsExpenseId,
  createdAt: expenses.createdAt,
  postedAt: expenses.postedAt,
  hasAttachments: sql<boolean>`exists (select 1 from ${schema.attachments} a where a.entity_type = 'expense' and a.entity_id = ${expenses.id})`,
};

function listConditions(q: ExpenseListQuery): SQL[] {
  const conditions: SQL[] = [];
  if (q.buildingId) conditions.push(eq(expenses.buildingId, q.buildingId));
  if (q.unitId) conditions.push(eq(expenses.unitId, q.unitId));
  if (q.categoryId) conditions.push(eq(expenses.categoryId, q.categoryId));
  if (q.vendorId) conditions.push(eq(expenses.vendorId, q.vendorId));
  if (q.kind) conditions.push(eq(expenses.kind, q.kind));
  if (q.status) conditions.push(eq(expenses.status, q.status));
  if (q.recurringRuleId) conditions.push(eq(expenses.recurringRuleId, q.recurringRuleId));
  if (q.disputeId) conditions.push(eq(expenses.disputeId, q.disputeId));
  if (q.period) {
    conditions.push(gte(expenses.invoiceDate, q.period.from));
    conditions.push(lte(expenses.invoiceDate, q.period.to));
  }
  if (q.search) {
    const like = `%${q.search}%`;
    conditions.push(
      sql`(${expenses.reasonAr} ilike ${like} or ${expenses.reasonEn} ilike ${like} or ${expenses.invoiceNo} ilike ${like} or ${vendors.name} ilike ${like})`,
    );
  }
  return conditions;
}

/** Staff expense table with filters and the totals of the filtered set; keyset on (invoice_date desc, id desc). */
export async function listExpenses(db: Dbx, q: ExpenseListQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions = listConditions(q);
  const pageConditions = [...conditions];
  if (cursor)
    pageConditions.push(
      orSql(
        lt(expenses.invoiceDate, cursor.key),
        and(eq(expenses.invoiceDate, cursor.key), lt(expenses.id, cursor.id)),
      ),
    );
  const base = () =>
    db
      .select(expenseListSelect)
      .from(expenses)
      .innerJoin(buildings, eq(buildings.id, expenses.buildingId))
      .leftJoin(units, eq(units.id, expenses.unitId))
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .leftJoin(vendors, eq(vendors.id, expenses.vendorId));
  const [rows, [totals]] = await Promise.all([
    base()
      .where(pageConditions.length ? and(...pageConditions) : undefined)
      .orderBy(desc(expenses.invoiceDate), desc(expenses.id))
      .limit(q.limit + 1),
    db
      .select({
        count: sql<number>`count(*)::int`,
        amountFils: sql<string>`coalesce(sum(${expenses.amountFils}), 0)`,
        vatFils: sql<string>`coalesce(sum(${expenses.vatFils}), 0)`,
        totalFils: sql<string>`coalesce(sum(${expenses.totalFils}), 0)`,
        fixedFils: sql<string>`coalesce(sum(${expenses.totalFils}) filter (where ${expenses.kind} = 'fixed'), 0)`,
        variableFils: sql<string>`coalesce(sum(${expenses.totalFils}) filter (where ${expenses.kind} = 'variable'), 0)`,
      })
      .from(expenses)
      .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
      .where(conditions.length ? and(...conditions) : undefined),
  ]);
  const p = page(rows, q.limit, (r) => ({ key: r.invoiceDate, id: r.id }));
  return {
    ...p,
    totals: {
      count: totals?.count ?? 0,
      amountFils: Number(totals?.amountFils ?? 0),
      vatFils: Number(totals?.vatFils ?? 0),
      totalFils: Number(totals?.totalFils ?? 0),
      fixedFils: Number(totals?.fixedFils ?? 0),
      variableFils: Number(totals?.variableFils ?? 0),
    },
  };
}

export async function getExpenseDetail(db: Dbx, id: string) {
  const [row] = await db
    .select({
      ...expenseListSelect,
      voidReason: expenses.voidReason,
      voidedAt: expenses.voidedAt,
      createdBy: expenses.createdBy,
      postedBy: expenses.postedBy,
      voidedBy: expenses.voidedBy,
      vendorTrn: vendors.trn,
      vendorPhone: vendors.phone,
      disputeCaseNo: disputes.caseNo,
    })
    .from(expenses)
    .innerJoin(buildings, eq(buildings.id, expenses.buildingId))
    .leftJoin(units, eq(units.id, expenses.unitId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
    .leftJoin(disputes, eq(disputes.id, expenses.disputeId))
    .where(eq(expenses.id, id));
  if (!row) throw notFound('Expense');
  const [allocations, attachments, workOrder, correctedBy, actors] = await Promise.all([
    db
      .select({
        id: expenseAllocations.id,
        unitId: expenseAllocations.unitId,
        unitNo: units.unitNo,
        ownerId: expenseAllocations.ownerId,
        nameAr: owners.nameAr,
        nameEn: owners.nameEn,
        amountFils: expenseAllocations.amountFils,
        onDate: expenseAllocations.onDate,
      })
      .from(expenseAllocations)
      .innerJoin(units, eq(units.id, expenseAllocations.unitId))
      .innerJoin(owners, eq(owners.id, expenseAllocations.ownerId))
      .where(eq(expenseAllocations.expenseId, id))
      .orderBy(asc(units.unitNo), asc(owners.nameEn)),
    listAttachments(db, 'expense', id),
    db
      .select({
        id: workOrders.id,
        titleAr: workOrders.titleAr,
        titleEn: workOrders.titleEn,
        status: workOrders.status,
      })
      .from(workOrders)
      .where(eq(workOrders.expenseId, id))
      .limit(1),
    db
      .select({ id: expenses.id, status: expenses.status })
      .from(expenses)
      .where(eq(expenses.correctsExpenseId, id))
      .limit(1),
    db
      .select({ id: staffUsers.id, name: staffUsers.name })
      .from(staffUsers)
      .where(
        inArray(
          staffUsers.id,
          [row.createdBy, row.postedBy, row.voidedBy].filter((x): x is string => x !== null),
        ),
      ),
  ]);
  const name = (sid: string | null) => actors.find((a) => a.id === sid)?.name ?? null;
  return {
    ...row,
    allocations,
    attachments,
    workOrder: workOrder[0] ?? null,
    correctedBy: correctedBy[0] ?? null,
    createdByName: name(row.createdBy),
    postedByName: name(row.postedBy),
    voidedByName: name(row.voidedBy),
  };
}

// Warnings (data quality) ----------------------------------------------------------------------------

export interface ExpenseWarnings {
  /** Another expense of the same vendor carries this invoice number. */
  duplicateInvoice: { expenseId: string; invoiceDate: string; status: ExpenseStatus } | null;
  /** More than three times the category's posted 12-month average. */
  outlier: { averageFils: number; count: number } | null;
}

export async function expenseWarnings(
  db: Dbx,
  input: {
    vendorId: string | null;
    invoiceNo: string | null;
    categoryId: string;
    totalFils: number;
    today: PlainDate;
    excludeId?: string | undefined;
  },
): Promise<ExpenseWarnings> {
  let duplicateInvoice: ExpenseWarnings['duplicateInvoice'] = null;
  if (input.vendorId && input.invoiceNo) {
    const conditions: SQL[] = [
      eq(expenses.vendorId, input.vendorId),
      eq(expenses.invoiceNo, input.invoiceNo),
      sql`${expenses.status} <> 'void'`,
    ];
    if (input.excludeId) conditions.push(sql`${expenses.id} <> ${input.excludeId}`);
    const [dup] = await db
      .select({ id: expenses.id, invoiceDate: expenses.invoiceDate, status: expenses.status })
      .from(expenses)
      .where(and(...conditions))
      .limit(1);
    if (dup)
      duplicateInvoice = { expenseId: dup.id, invoiceDate: dup.invoiceDate, status: dup.status };
  }
  const [y, m, d] = input.today.split('-').map(Number) as [number, number, number];
  const yearAgo = `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const [avg] = await db
    .select({
      averageFils: sql<string>`coalesce(avg(${expenses.totalFils}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.categoryId, input.categoryId),
        eq(expenses.status, 'posted'),
        gte(expenses.invoiceDate, yearAgo),
        input.excludeId ? sql`${expenses.id} <> ${input.excludeId}` : undefined,
      ),
    );
  const averageFils = Math.round(Number(avg?.averageFils ?? 0));
  const count = avg?.count ?? 0;
  const outlier =
    count >= 3 && isExpenseOutlier(input.totalFils, averageFils) ? { averageFils, count } : null;
  return { duplicateInvoice, outlier };
}

// Life cycle ---------------------------------------------------------------------------------------

async function resolveVat(
  db: Dbx,
  vendorId: string | null,
  amountFils: number,
  vatFils: number | undefined,
) {
  if (vatFils !== undefined) return vatFils;
  if (!vendorId) return 0;
  const vendor = await db.query.vendors.findFirst({
    where: eq(vendors.id, vendorId),
    columns: { trn: true },
  });
  return vendor?.trn ? vatFor(amountFils) : 0;
}

async function checkReferences(
  db: Dbx,
  input: {
    buildingId: string;
    unitId: string | null;
    categoryId: string;
    vendorId: string | null;
    disputeId: string | null;
  },
) {
  const [building, unit, category, vendor, dispute] = await Promise.all([
    db.query.buildings.findFirst({
      where: eq(buildings.id, input.buildingId),
      columns: { id: true },
    }),
    input.unitId
      ? db.query.units.findFirst({
          where: eq(units.id, input.unitId),
          columns: { id: true, buildingId: true },
        })
      : Promise.resolve(undefined),
    db.query.expenseCategories.findFirst({ where: eq(expenseCategories.id, input.categoryId) }),
    input.vendorId
      ? db.query.vendors.findFirst({ where: eq(vendors.id, input.vendorId), columns: { id: true } })
      : Promise.resolve(undefined),
    input.disputeId
      ? db.query.disputes.findFirst({
          where: eq(disputes.id, input.disputeId),
          columns: { id: true },
        })
      : Promise.resolve(undefined),
  ]);
  if (!building) throw notFound('Building');
  if (input.unitId && unit?.buildingId !== input.buildingId) throw notFound('Unit');
  if (!category) throw notFound('Category');
  if (!category.active) throw validation('The category is no longer active');
  if (input.vendorId && !vendor) throw notFound('Vendor');
  if (input.disputeId && !dispute) throw notFound('Dispute');
  return category;
}

async function linkWorkOrder(db: Dbx, workOrderId: string | null, expenseId: string) {
  if (!workOrderId) return;
  const wo = await db.query.workOrders.findFirst({ where: eq(workOrders.id, workOrderId) });
  if (!wo) throw notFound('Work order');
  await db.update(workOrders).set({ expenseId }).where(eq(workOrders.id, workOrderId));
}

/** A new draft. `allocationMethod` is fixed now so the preview and the posting agree. */
export async function createExpense(db: Dbx, actor: AuditActor, input: CreateExpenseInput) {
  const category = await checkReferences(db, input);
  const allocationUnits = await allocationUnitsFor(
    db,
    input.scope,
    input.buildingId,
    input.unitId,
    input.invoiceDate,
  );
  const method = resolveMethod(input.scope, input.allocationMethod, allocationUnits);
  const vatFils = await resolveVat(db, input.vendorId, input.amountFils, input.vatFils);
  const { workOrderId, allocationMethod: _m, ...fields } = input;
  const [row] = await db
    .insert(expenses)
    .values({
      ...fields,
      kind: category.kind,
      vatFils,
      totalFils: expenseTotal(input.amountFils, vatFils),
      allocationMethod: method,
      status: 'draft',
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await linkWorkOrder(db, workOrderId, row.id);
  await audit(db, actor, {
    action: 'expense.create',
    entityType: 'expense',
    entityId: row.id,
    after: row,
  });
  return row;
}

/** Drafts only; a posted expense is voided and re-posted instead so history stays whole. */
export async function updateExpense(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: UpdateExpenseInput,
) {
  const before = await db.query.expenses.findFirst({ where: eq(expenses.id, id) });
  if (!before) throw notFound('Expense');
  if (before.status !== 'draft')
    throw new ApiError(
      409,
      'conflict',
      'Only a draft can be edited; void a posted expense and post a corrected copy',
    );
  const merged = {
    scope: patch.scope ?? before.scope,
    buildingId: patch.buildingId ?? before.buildingId,
    unitId: patch.unitId === undefined ? before.unitId : patch.unitId,
    categoryId: patch.categoryId ?? before.categoryId,
    vendorId: patch.vendorId === undefined ? before.vendorId : patch.vendorId,
    disputeId: patch.disputeId === undefined ? before.disputeId : patch.disputeId,
    invoiceDate: (patch.invoiceDate ?? before.invoiceDate) as PlainDate,
    amountFils: patch.amountFils ?? before.amountFils,
  };
  if (merged.scope === 'unit' && merged.unitId === null)
    throw validation('A unit expense needs a unit');
  const category = await checkReferences(db, merged);
  const allocationUnits = await allocationUnitsFor(
    db,
    merged.scope,
    merged.buildingId,
    merged.scope === 'unit' ? merged.unitId : null,
    merged.invoiceDate,
  );
  const method = resolveMethod(
    merged.scope,
    patch.allocationMethod ?? before.allocationMethod,
    allocationUnits,
  );
  const vatFils =
    patch.vatFils ??
    (patch.vendorId !== undefined || patch.amountFils !== undefined
      ? await resolveVat(db, merged.vendorId, merged.amountFils, undefined)
      : before.vatFils);
  const { workOrderId, allocationMethod: _m, ...fields } = patch;
  const [after] = await db
    .update(expenses)
    .set({
      ...clean(fields),
      unitId: merged.scope === 'unit' ? merged.unitId : null,
      kind: category.kind,
      vatFils,
      totalFils: expenseTotal(merged.amountFils, vatFils),
      allocationMethod: method,
    })
    .where(eq(expenses.id, id))
    .returning();
  if (workOrderId !== undefined) await linkWorkOrder(db, workOrderId, id);
  await audit(db, actor, {
    action: 'expense.update',
    entityType: 'expense',
    entityId: id,
    before,
    after,
  });
  return after;
}

/** Staff may discard their own drafts (the cron's too); posted expenses are voided by an admin. */
export async function deleteDraft(db: Dbx, actor: AuditActor, id: string) {
  const before = await db.query.expenses.findFirst({ where: eq(expenses.id, id) });
  if (!before) throw notFound('Expense');
  if (before.status !== 'draft') throw conflict('Only a draft can be deleted');
  await db.update(workOrders).set({ expenseId: null }).where(eq(workOrders.expenseId, id));
  await db.delete(expenses).where(eq(expenses.id, id));
  await audit(db, actor, {
    action: 'expense.delete_draft',
    entityType: 'expense',
    entityId: id,
    before,
  });
  return { ok: true as const };
}

export interface PostResult {
  expense: typeof expenses.$inferSelect;
  allocations: (typeof expenseAllocations.$inferSelect)[];
  /** At or above the alert threshold: the route notifies the owners. */
  large: boolean;
}

/** Draft -> posted: the allocations are computed from the ownership on the invoice date and written once. */
export async function postExpense(
  db: Dbx,
  actor: AuditActor,
  id: string,
  largeExpenseAlertFils: number,
): Promise<PostResult> {
  const before = await db.query.expenses.findFirst({ where: eq(expenses.id, id) });
  if (!before) throw notFound('Expense');
  if (before.status !== 'draft') throw conflict(`Expense is ${before.status}, not a draft`);
  const allocationUnits = await allocationUnitsFor(
    db,
    before.scope,
    before.buildingId,
    before.unitId,
    before.invoiceDate as PlainDate,
  );
  let parts;
  try {
    parts = allocateExpense(before.totalFils, before.allocationMethod, allocationUnits);
  } catch (e) {
    throw validation(e instanceof Error ? e.message : 'Cannot allocate');
  }
  const allocations = parts.length
    ? await db
        .insert(expenseAllocations)
        .values(
          parts.map((p) => ({
            expenseId: id,
            unitId: p.unitId,
            ownerId: p.ownerId,
            amountFils: p.amountFils,
            onDate: before.invoiceDate,
          })),
        )
        .returning()
    : [];
  const [expense] = await db
    .update(expenses)
    .set({
      status: 'posted',
      postedAt: new Date(),
      postedBy: actor.type === 'staff' ? actor.id : null,
    })
    .where(eq(expenses.id, id))
    .returning();
  if (!expense) throw new Error('update failed');
  await audit(db, actor, {
    action: 'expense.post',
    entityType: 'expense',
    entityId: id,
    before,
    after: {
      ...expense,
      allocations: allocations.map((a) => ({
        ownerId: a.ownerId,
        unitId: a.unitId,
        amountFils: a.amountFils,
      })),
    },
  });
  return { expense, allocations, large: isLargeExpense(expense.totalFils, largeExpenseAlertFils) };
}

/**
 * Void a posted expense (admin). Its allocations stay as history but no total counts them. With a
 * `correction`, the corrected copy is created and posted in the same transaction and points back
 * at the voided one.
 */
export async function voidExpense(
  db: Dbx,
  actor: AuditActor,
  id: string,
  reason: string,
  correction: CreateExpenseInput | undefined,
  largeExpenseAlertFils: number,
): Promise<{ voided: typeof expenses.$inferSelect; correction: PostResult | null }> {
  const before = await db.query.expenses.findFirst({ where: eq(expenses.id, id) });
  if (!before) throw notFound('Expense');
  if (before.status === 'void') throw conflict('Expense is already void');
  const [voided] = await db
    .update(expenses)
    .set({
      status: 'void',
      voidReason: reason,
      voidedAt: new Date(),
      voidedBy: actor.type === 'staff' ? actor.id : null,
    })
    .where(eq(expenses.id, id))
    .returning();
  if (!voided) throw new Error('update failed');
  await audit(db, actor, {
    action: 'expense.void',
    entityType: 'expense',
    entityId: id,
    before,
    after: { ...voided, reason },
  });
  if (!correction) return { voided, correction: null };
  const draft = await createExpense(db, actor, correction);
  await db.update(expenses).set({ correctsExpenseId: id }).where(eq(expenses.id, draft.id));
  const posted = await postExpense(db, actor, draft.id, largeExpenseAlertFils);
  return { voided, correction: posted };
}

/** The current owners of the expense's units, for the large-expense push. */
export async function expenseOwnerIds(db: Dbx, expenseId: string): Promise<string[]> {
  const rows = await db
    .select({ ownerId: expenseAllocations.ownerId })
    .from(expenseAllocations)
    .where(eq(expenseAllocations.expenseId, expenseId));
  return [...new Set(rows.map((r) => r.ownerId))];
}

// Recurring rules ----------------------------------------------------------------------------------

export async function listRules(
  db: Dbx,
  q: { buildingId?: string | undefined; includeInactive?: boolean },
) {
  const conditions: SQL[] = [];
  if (q.buildingId) conditions.push(eq(recurringExpenseRules.buildingId, q.buildingId));
  if (!q.includeInactive) conditions.push(eq(recurringExpenseRules.active, true));
  return db
    .select({
      id: recurringExpenseRules.id,
      scope: recurringExpenseRules.scope,
      buildingId: recurringExpenseRules.buildingId,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      unitId: recurringExpenseRules.unitId,
      unitNo: units.unitNo,
      categoryId: recurringExpenseRules.categoryId,
      categoryNameAr: expenseCategories.nameAr,
      categoryNameEn: expenseCategories.nameEn,
      vendorId: recurringExpenseRules.vendorId,
      vendorName: vendors.name,
      reasonAr: recurringExpenseRules.reasonAr,
      reasonEn: recurringExpenseRules.reasonEn,
      amountFils: recurringExpenseRules.amountFils,
      vatFils: recurringExpenseRules.vatFils,
      frequency: recurringExpenseRules.frequency,
      dayOfMonth: recurringExpenseRules.dayOfMonth,
      startDate: recurringExpenseRules.startDate,
      endDate: recurringExpenseRules.endDate,
      allocationMethod: recurringExpenseRules.allocationMethod,
      visibleToOwner: recurringExpenseRules.visibleToOwner,
      active: recurringExpenseRules.active,
      createdAt: recurringExpenseRules.createdAt,
    })
    .from(recurringExpenseRules)
    .innerJoin(buildings, eq(buildings.id, recurringExpenseRules.buildingId))
    .leftJoin(units, eq(units.id, recurringExpenseRules.unitId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, recurringExpenseRules.categoryId))
    .leftJoin(vendors, eq(vendors.id, recurringExpenseRules.vendorId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(buildings.nameEn), asc(recurringExpenseRules.reasonEn));
}

export async function createRule(db: Dbx, actor: AuditActor, input: CreateRecurringRuleInput) {
  const category = await checkReferences(db, { ...input, disputeId: null });
  if (category.kind !== 'fixed') throw validation('Recurring rules are for fixed costs');
  const allocationUnits = await allocationUnitsFor(
    db,
    input.scope,
    input.buildingId,
    input.unitId,
    input.startDate,
  );
  const method = resolveMethod(input.scope, input.allocationMethod, allocationUnits);
  const vatFils = await resolveVat(db, input.vendorId, input.amountFils, input.vatFils);
  const { allocationMethod: _m, ...fields } = input;
  const [row] = await db
    .insert(recurringExpenseRules)
    .values({
      ...fields,
      vatFils,
      allocationMethod: method,
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'recurring_rule.create',
    entityType: 'recurring_rule',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateRule(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateRecurringRuleInput>,
) {
  const before = await db.query.recurringExpenseRules.findFirst({
    where: eq(recurringExpenseRules.id, id),
  });
  if (!before) throw notFound('Rule');
  const merged = {
    scope: patch.scope ?? before.scope,
    buildingId: patch.buildingId ?? before.buildingId,
    unitId: patch.unitId === undefined ? before.unitId : patch.unitId,
    categoryId: patch.categoryId ?? before.categoryId,
    vendorId: patch.vendorId === undefined ? before.vendorId : patch.vendorId,
    amountFils: patch.amountFils ?? before.amountFils,
    startDate: (patch.startDate ?? before.startDate) as PlainDate,
    endDate: patch.endDate === undefined ? before.endDate : patch.endDate,
  };
  if (merged.scope === 'unit' && merged.unitId === null)
    throw validation('A unit rule needs a unit');
  if (merged.endDate !== null && merged.endDate < merged.startDate)
    throw validation('endDate must be on or after startDate');
  const category = await checkReferences(db, { ...merged, disputeId: null });
  if (category.kind !== 'fixed') throw validation('Recurring rules are for fixed costs');
  const allocationUnits = await allocationUnitsFor(
    db,
    merged.scope,
    merged.buildingId,
    merged.unitId,
    merged.startDate,
  );
  const method = resolveMethod(
    merged.scope,
    patch.allocationMethod ?? before.allocationMethod,
    allocationUnits,
  );
  const vatFils =
    patch.vatFils ??
    (patch.vendorId !== undefined || patch.amountFils !== undefined
      ? await resolveVat(db, merged.vendorId, merged.amountFils, undefined)
      : before.vatFils);
  const { allocationMethod: _m, ...fields } = patch;
  const [after] = await db
    .update(recurringExpenseRules)
    .set({
      ...clean(fields),
      unitId: merged.scope === 'unit' ? merged.unitId : null,
      vatFils,
      allocationMethod: method,
    })
    .where(eq(recurringExpenseRules.id, id))
    .returning();
  await audit(db, actor, {
    action: 'recurring_rule.update',
    entityType: 'recurring_rule',
    entityId: id,
    before,
    after,
  });
  return after;
}

/** How far back the cron catches up on due dates it missed (a Worker outage, a paused rule). */
export const RECURRING_CATCH_UP_DAYS = 7;

/**
 * Daily: every active rule's due dates in the last week that have no expense yet become drafts
 * for staff to check and post. Idempotent: (rule, invoice date) is created at most once.
 */
export async function createRecurringDrafts(db: Dbx, today: PlainDate): Promise<number> {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const since = new Date(Date.UTC(y, m - 1, d - RECURRING_CATCH_UP_DAYS))
    .toISOString()
    .slice(0, 10) as PlainDate;
  const rules = await db
    .select()
    .from(recurringExpenseRules)
    .where(
      and(eq(recurringExpenseRules.active, true), lte(recurringExpenseRules.startDate, today)),
    );
  if (rules.length === 0) return 0;
  const existing = await db
    .select({ ruleId: expenses.recurringRuleId, invoiceDate: expenses.invoiceDate })
    .from(expenses)
    .where(
      and(
        inArray(
          expenses.recurringRuleId,
          rules.map((r) => r.id),
        ),
        gte(expenses.invoiceDate, since),
      ),
    );
  const have = new Set(existing.map((e) => `${e.ruleId ?? ''}|${e.invoiceDate}`));
  let created = 0;
  for (const rule of rules) {
    const due = recurringDueDates(
      {
        frequency: rule.frequency,
        dayOfMonth: rule.dayOfMonth,
        startDate: rule.startDate as PlainDate,
        endDate: rule.endDate as PlainDate | null,
      },
      { from: since, to: today },
    );
    for (const dueDate of due) {
      if (have.has(`${rule.id}|${dueDate}`)) continue;
      const [row] = await db
        .insert(expenses)
        .values({
          scope: rule.scope,
          buildingId: rule.buildingId,
          unitId: rule.unitId,
          categoryId: rule.categoryId,
          kind: 'fixed',
          vendorId: rule.vendorId,
          reasonAr: rule.reasonAr,
          reasonEn: rule.reasonEn,
          invoiceNo: null,
          invoiceDate: dueDate,
          coversFrom: coveredFrom(dueDate),
          coversTo: coveredTo(dueDate, rule.frequency),
          amountFils: rule.amountFils,
          vatFils: rule.vatFils,
          totalFils: expenseTotal(rule.amountFils, rule.vatFils),
          status: 'draft',
          allocationMethod: rule.allocationMethod,
          visibleToOwner: rule.visibleToOwner,
          recurringRuleId: rule.id,
          createdBy: null,
        })
        .returning({ id: expenses.id });
      if (row) {
        created += 1;
        await audit(
          db,
          { type: 'system', id: null, ip: null, userAgent: null },
          {
            action: 'expense.create_draft_from_rule',
            entityType: 'expense',
            entityId: row.id,
            after: { ruleId: rule.id, dueDate },
          },
        );
      }
    }
  }
  return created;
}

function coveredFrom(dueDate: PlainDate): PlainDate {
  return `${dueDate.slice(0, 7)}-01` as PlainDate;
}

function coveredTo(dueDate: PlainDate, frequency: 'monthly' | 'quarterly' | 'yearly'): PlainDate {
  const [y, m] = dueDate.split('-').map(Number) as [number, number];
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const end = new Date(Date.UTC(y, m - 1 + months, 0));
  return end.toISOString().slice(0, 10) as PlainDate;
}

// Owner side ---------------------------------------------------------------------------------------

export interface OwnerExpenseQuery {
  buildingId?: string | undefined;
  unitId?: string | undefined;
  categoryId?: string | undefined;
  kind?: ExpenseKind | undefined;
  period?: Period | null | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Posted, visible expenses the owner has a share in; amounts are the owner's share. */
export async function ownerExpenses(db: Dbx, ownerId: string, q: OwnerExpenseQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions: SQL[] = [
    eq(expenseAllocations.ownerId, ownerId),
    eq(expenses.status, 'posted'),
    eq(expenses.visibleToOwner, true),
  ];
  if (q.buildingId) conditions.push(eq(expenses.buildingId, q.buildingId));
  if (q.unitId) conditions.push(eq(expenseAllocations.unitId, q.unitId));
  if (q.categoryId) conditions.push(eq(expenses.categoryId, q.categoryId));
  if (q.kind) conditions.push(eq(expenses.kind, q.kind));
  if (q.period) {
    conditions.push(gte(expenseAllocations.onDate, q.period.from));
    conditions.push(lte(expenseAllocations.onDate, q.period.to));
  }
  const grouped = db
    .select({
      expenseId: expenseAllocations.expenseId,
      shareFils: sql<string>`sum(${expenseAllocations.amountFils})`.as('share_fils'),
      unitIds: sql<string[]>`array_agg(distinct ${expenseAllocations.unitId})`.as('unit_ids'),
    })
    .from(expenseAllocations)
    .innerJoin(expenses, eq(expenses.id, expenseAllocations.expenseId))
    .where(and(...conditions))
    .groupBy(expenseAllocations.expenseId)
    .as('mine');
  const pageConditions: SQL[] = [];
  if (cursor)
    pageConditions.push(
      orSql(
        lt(expenses.invoiceDate, cursor.key),
        and(eq(expenses.invoiceDate, cursor.key), lt(expenses.id, cursor.id)),
      ),
    );
  const rows = await db
    .select({
      id: expenses.id,
      scope: expenses.scope,
      buildingId: expenses.buildingId,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      unitId: expenses.unitId,
      unitNo: units.unitNo,
      unitIds: grouped.unitIds,
      categoryId: expenses.categoryId,
      categoryNameAr: expenseCategories.nameAr,
      categoryNameEn: expenseCategories.nameEn,
      kind: expenses.kind,
      vendorName: vendors.name,
      reasonAr: expenses.reasonAr,
      reasonEn: expenses.reasonEn,
      invoiceNo: expenses.invoiceNo,
      invoiceDate: expenses.invoiceDate,
      coversFrom: expenses.coversFrom,
      coversTo: expenses.coversTo,
      grossAmountFils: expenses.amountFils,
      grossVatFils: expenses.vatFils,
      grossTotalFils: expenses.totalFils,
      shareFils: grouped.shareFils,
      paidOn: expenses.paidOn,
      hasAttachments: sql<boolean>`exists (select 1 from ${schema.attachments} a where a.entity_type = 'expense' and a.entity_id = ${expenses.id})`,
    })
    .from(grouped)
    .innerJoin(expenses, eq(expenses.id, grouped.expenseId))
    .innerJoin(buildings, eq(buildings.id, expenses.buildingId))
    .leftJoin(units, eq(units.id, expenses.unitId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(pageConditions.length ? and(...pageConditions) : undefined)
    .orderBy(desc(expenses.invoiceDate), desc(expenses.id))
    .limit(q.limit + 1);
  const p = page(rows, q.limit, (r) => ({ key: r.invoiceDate, id: r.id }));
  return {
    items: p.items.map((r) => ({
      ...r,
      amountFils: Number(r.shareFils),
      shared: Number(r.shareFils) < r.grossTotalFils,
    })),
    nextCursor: p.nextCursor,
  };
}

/** One expense in the owner's scope with its invoice files (when settings allow) and the linked work order. */
export async function ownerExpenseDetail(
  db: Dbx,
  ownerId: string,
  expenseId: string,
  filesAllowed: boolean,
) {
  const [mine] = await db
    .select({
      shareFils: sql<string>`sum(${expenseAllocations.amountFils})`,
      unitIds: sql<string[]>`array_agg(distinct ${expenseAllocations.unitId})`,
    })
    .from(expenseAllocations)
    .innerJoin(expenses, eq(expenses.id, expenseAllocations.expenseId))
    .where(
      and(
        eq(expenseAllocations.expenseId, expenseId),
        eq(expenseAllocations.ownerId, ownerId),
        eq(expenses.status, 'posted'),
        eq(expenses.visibleToOwner, true),
      ),
    )
    .groupBy(expenseAllocations.expenseId);
  if (!mine) throw notFound('Expense');
  const [row] = await db
    .select({
      id: expenses.id,
      scope: expenses.scope,
      buildingId: expenses.buildingId,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      unitId: expenses.unitId,
      unitNo: units.unitNo,
      categoryId: expenses.categoryId,
      categoryNameAr: expenseCategories.nameAr,
      categoryNameEn: expenseCategories.nameEn,
      kind: expenses.kind,
      vendorName: vendors.name,
      reasonAr: expenses.reasonAr,
      reasonEn: expenses.reasonEn,
      invoiceNo: expenses.invoiceNo,
      invoiceDate: expenses.invoiceDate,
      coversFrom: expenses.coversFrom,
      coversTo: expenses.coversTo,
      grossAmountFils: expenses.amountFils,
      grossVatFils: expenses.vatFils,
      grossTotalFils: expenses.totalFils,
      paidOn: expenses.paidOn,
      paymentMethod: expenses.paymentMethod,
      allocationMethod: expenses.allocationMethod,
      disputeId: expenses.disputeId,
      disputeCaseNo: disputes.caseNo,
    })
    .from(expenses)
    .innerJoin(buildings, eq(buildings.id, expenses.buildingId))
    .leftJoin(units, eq(units.id, expenses.unitId))
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
    .leftJoin(disputes, eq(disputes.id, expenses.disputeId))
    .where(eq(expenses.id, expenseId));
  if (!row) throw notFound('Expense');
  const [attachments, workOrder] = await Promise.all([
    filesAllowed ? listAttachments(db, 'expense', expenseId) : Promise.resolve([]),
    db
      .select({
        id: workOrders.id,
        titleAr: workOrders.titleAr,
        titleEn: workOrders.titleEn,
        status: workOrders.status,
        completedAt: workOrders.completedAt,
      })
      .from(workOrders)
      .where(and(eq(workOrders.expenseId, expenseId), eq(workOrders.visibleToOwner, true)))
      .limit(1),
  ]);
  return {
    ...row,
    unitIds: mine.unitIds,
    amountFils: Number(mine.shareFils),
    shared: Number(mine.shareFils) < row.grossTotalFils,
    attachments,
    workOrder: workOrder[0] ?? null,
  };
}

/** Whether an attachment belongs to an expense the owner may see. */
export async function expenseAttachmentInOwnerScope(
  db: Dbx,
  ownerId: string,
  expenseId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: expenseAllocations.id })
    .from(expenseAllocations)
    .innerJoin(expenses, eq(expenses.id, expenseAllocations.expenseId))
    .where(
      and(
        eq(expenseAllocations.expenseId, expenseId),
        eq(expenseAllocations.ownerId, ownerId),
        eq(expenses.status, 'posted'),
        eq(expenses.visibleToOwner, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}
