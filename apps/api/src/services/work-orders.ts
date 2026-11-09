/**
 * Work orders: maintenance and breakdowns, with before and after photos as attachments and the
 * invoice that paid for the job as a linked expense. Owners see their units' orders.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type {
  CreateWorkOrderInput,
  PlainDate,
  WorkOrderPriority,
  WorkOrderStatus,
} from '@vamar/shared';
import { andSql, orSql, type Dbx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import type { Patch } from '../util/types.js';
import { decodeCursor, page } from '../util/pagination.js';
import { listAttachments } from './attachments.js';
import { audit, type AuditActor } from './audit.js';
import { ownerUnitsSubquery } from './owner-scope.js';

const { workOrders, buildings, units, vendors, expenses, unitOwnerships } = schema;

function clean<T extends object>(patch: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export interface WorkOrderListQuery {
  buildingId?: string | undefined;
  unitId?: string | undefined;
  status?: WorkOrderStatus | undefined;
  priority?: WorkOrderPriority | undefined;
  vendorId?: string | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

const workOrderSelect = {
  id: workOrders.id,
  buildingId: workOrders.buildingId,
  buildingNameAr: buildings.nameAr,
  buildingNameEn: buildings.nameEn,
  unitId: workOrders.unitId,
  unitNo: units.unitNo,
  titleAr: workOrders.titleAr,
  titleEn: workOrders.titleEn,
  description: workOrders.description,
  priority: workOrders.priority,
  status: workOrders.status,
  reportedOn: workOrders.reportedOn,
  scheduledFor: workOrders.scheduledFor,
  completedAt: workOrders.completedAt,
  vendorId: workOrders.vendorId,
  vendorName: vendors.name,
  expenseId: workOrders.expenseId,
  expenseTotalFils: expenses.totalFils,
  expenseStatus: expenses.status,
  expenseVisibleToOwner: expenses.visibleToOwner,
  visibleToOwner: workOrders.visibleToOwner,
  createdAt: workOrders.createdAt,
  photoCount: sql<number>`(select count(*)::int from ${schema.attachments} a where a.entity_type = 'work_order' and a.entity_id = ${workOrders.id})`,
};

function baseQuery(db: Dbx) {
  return db
    .select(workOrderSelect)
    .from(workOrders)
    .innerJoin(buildings, eq(buildings.id, workOrders.buildingId))
    .leftJoin(units, eq(units.id, workOrders.unitId))
    .leftJoin(vendors, eq(vendors.id, workOrders.vendorId))
    .leftJoin(expenses, eq(expenses.id, workOrders.expenseId));
}

/** Staff list and board; keyset on (reported_on desc, id desc). */
export async function listWorkOrders(db: Dbx, q: WorkOrderListQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions: SQL[] = [];
  if (q.buildingId) conditions.push(eq(workOrders.buildingId, q.buildingId));
  if (q.unitId) conditions.push(eq(workOrders.unitId, q.unitId));
  if (q.status) conditions.push(eq(workOrders.status, q.status));
  if (q.priority) conditions.push(eq(workOrders.priority, q.priority));
  if (q.vendorId) conditions.push(eq(workOrders.vendorId, q.vendorId));
  if (q.search) {
    const like = `%${q.search}%`;
    conditions.push(
      sql`(${workOrders.titleAr} ilike ${like} or ${workOrders.titleEn} ilike ${like} or ${workOrders.description} ilike ${like})`,
    );
  }
  if (cursor)
    conditions.push(
      orSql(
        lt(workOrders.reportedOn, cursor.key),
        and(eq(workOrders.reportedOn, cursor.key), lt(workOrders.id, cursor.id)),
      ),
    );
  const rows = await baseQuery(db)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(workOrders.reportedOn), desc(workOrders.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.reportedOn, id: r.id }));
}

export async function getWorkOrderDetail(db: Dbx, id: string) {
  const [row] = await baseQuery(db).where(eq(workOrders.id, id));
  if (!row) throw notFound('Work order');
  const attachments = await listAttachments(db, 'work_order', id);
  return { ...row, attachments };
}

async function checkReferences(
  db: Dbx,
  input: {
    buildingId: string;
    unitId: string | null;
    vendorId: string | null;
    expenseId: string | null;
  },
) {
  const [building, unit, vendor, expense] = await Promise.all([
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
    input.vendorId
      ? db.query.vendors.findFirst({ where: eq(vendors.id, input.vendorId), columns: { id: true } })
      : Promise.resolve(undefined),
    input.expenseId
      ? db.query.expenses.findFirst({
          where: eq(expenses.id, input.expenseId),
          columns: { id: true },
        })
      : Promise.resolve(undefined),
  ]);
  if (!building) throw notFound('Building');
  if (input.unitId && unit?.buildingId !== input.buildingId) throw notFound('Unit');
  if (input.vendorId && !vendor) throw notFound('Vendor');
  if (input.expenseId && !expense) throw notFound('Expense');
}

export async function createWorkOrder(
  db: Dbx,
  actor: AuditActor,
  input: CreateWorkOrderInput,
  today: PlainDate,
) {
  await checkReferences(db, input);
  const { reportedOn, ...fields } = input;
  const [row] = await db
    .insert(workOrders)
    .values({
      ...fields,
      reportedOn: reportedOn ?? today,
      completedAt: input.status === 'done' ? new Date() : null,
      createdBy: actor.type === 'staff' ? actor.id : null,
    })
    .returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'work_order.create',
    entityType: 'work_order',
    entityId: row.id,
    after: row,
  });
  return row;
}

export interface WorkOrderUpdateResult {
  row: typeof workOrders.$inferSelect;
  /** Just marked done: the route notifies the owners. */
  justDone: boolean;
}

export async function updateWorkOrder(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateWorkOrderInput>,
): Promise<WorkOrderUpdateResult> {
  const before = await db.query.workOrders.findFirst({ where: eq(workOrders.id, id) });
  if (!before) throw notFound('Work order');
  if (before.status === 'cancelled' && patch.status !== undefined && patch.status !== 'cancelled')
    throw conflict('A cancelled work order stays cancelled; open a new one');
  await checkReferences(db, {
    buildingId: patch.buildingId ?? before.buildingId,
    unitId: patch.unitId === undefined ? before.unitId : patch.unitId,
    vendorId: patch.vendorId === undefined ? before.vendorId : patch.vendorId,
    expenseId: patch.expenseId === undefined ? before.expenseId : patch.expenseId,
  });
  const justDone = patch.status === 'done' && before.status !== 'done';
  const [row] = await db
    .update(workOrders)
    .set({
      ...clean(patch),
      completedAt: justDone
        ? new Date()
        : patch.status !== undefined && patch.status !== 'done'
          ? null
          : before.completedAt,
    })
    .where(eq(workOrders.id, id))
    .returning();
  if (!row) throw new Error('update failed');
  await audit(db, actor, {
    action: 'work_order.update',
    entityType: 'work_order',
    entityId: id,
    before,
    after: row,
  });
  return { row, justDone };
}

/** Owners of the unit (or, for a building-wide job, of any unit in the building), for the "done" push. */
export async function workOrderOwnerIds(db: Dbx, workOrderId: string): Promise<string[]> {
  const wo = await db.query.workOrders.findFirst({ where: eq(workOrders.id, workOrderId) });
  if (!wo?.visibleToOwner) return [];
  const rows = await db
    .select({ ownerId: unitOwnerships.ownerId })
    .from(unitOwnerships)
    .innerJoin(units, eq(units.id, unitOwnerships.unitId))
    .where(
      and(
        isNull(unitOwnerships.toDate),
        wo.unitId ? eq(unitOwnerships.unitId, wo.unitId) : eq(units.buildingId, wo.buildingId),
      ),
    );
  return [...new Set(rows.map((r) => r.ownerId))];
}

/** `work_orders` visible to this owner: on their units, or building-wide in a building they own in. */
export function workOrderInOwnerScope(db: Dbx, ownerId: string): SQL {
  const myUnits = ownerUnitsSubquery(db, ownerId);
  const myBuildings = db
    .select({ buildingId: units.buildingId })
    .from(units)
    .where(inArray(units.id, ownerUnitsSubquery(db, ownerId)));
  return andSql(
    eq(workOrders.visibleToOwner, true),
    or(
      inArray(workOrders.unitId, myUnits),
      and(isNull(workOrders.unitId), inArray(workOrders.buildingId, myBuildings)),
    ),
  );
}

export async function ownerWorkOrders(
  db: Dbx,
  ownerId: string,
  q: {
    unitId?: string | undefined;
    status?: WorkOrderStatus | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  const cursor = decodeCursor(q.cursor);
  const conditions: SQL[] = [workOrderInOwnerScope(db, ownerId)];
  if (q.unitId) conditions.push(eq(workOrders.unitId, q.unitId));
  if (q.status) conditions.push(eq(workOrders.status, q.status));
  if (cursor)
    conditions.push(
      orSql(
        lt(workOrders.reportedOn, cursor.key),
        and(eq(workOrders.reportedOn, cursor.key), lt(workOrders.id, cursor.id)),
      ),
    );
  const rows = await db
    .select({
      id: workOrders.id,
      buildingId: workOrders.buildingId,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      unitId: workOrders.unitId,
      unitNo: units.unitNo,
      titleAr: workOrders.titleAr,
      titleEn: workOrders.titleEn,
      description: workOrders.description,
      priority: workOrders.priority,
      status: workOrders.status,
      reportedOn: workOrders.reportedOn,
      scheduledFor: workOrders.scheduledFor,
      completedAt: workOrders.completedAt,
      vendorName: vendors.name,
      expenseId: sql<
        string | null
      >`case when ${expenses.status} = 'posted' and ${expenses.visibleToOwner} then ${expenses.id} else null end`,
      photoCount: sql<number>`(select count(*)::int from ${schema.attachments} a where a.entity_type = 'work_order' and a.entity_id = ${workOrders.id})`,
    })
    .from(workOrders)
    .innerJoin(buildings, eq(buildings.id, workOrders.buildingId))
    .leftJoin(units, eq(units.id, workOrders.unitId))
    .leftJoin(vendors, eq(vendors.id, workOrders.vendorId))
    .leftJoin(expenses, eq(expenses.id, workOrders.expenseId))
    .where(and(...conditions))
    .orderBy(desc(workOrders.reportedOn), desc(workOrders.id))
    .limit(q.limit + 1);
  return page(rows, q.limit, (r) => ({ key: r.reportedOn, id: r.id }));
}

/**
 * What an owner may know of the expense that paid for a job: its total only when the expense is
 * posted and visible to owners, otherwise nothing (a hidden or draft cost never leaks).
 */
export function ownerVisibleCost(e: {
  status: string | null;
  visibleToOwner: boolean | null;
  totalFils: number | null;
}): number | null {
  return e.status === 'posted' && e.visibleToOwner === true ? e.totalFils : null;
}

export async function ownerWorkOrderDetail(db: Dbx, ownerId: string, id: string) {
  const [row] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.id, id), workOrderInOwnerScope(db, ownerId)));
  if (!row) throw notFound('Work order');
  const detail = await getWorkOrderDetail(db, id);
  const cost = ownerVisibleCost({
    status: detail.expenseStatus,
    visibleToOwner: detail.expenseVisibleToOwner,
    totalFils: detail.expenseTotalFils,
  });
  const expenseVisible = cost !== null;
  return {
    ...detail,
    expenseId: expenseVisible ? detail.expenseId : null,
    expenseTotalFils: cost,
    expenseStatus: expenseVisible ? detail.expenseStatus : null,
    expenseVisibleToOwner: expenseVisible,
  };
}

/** Whether an attachment belongs to a work order the owner may see. */
export async function workOrderAttachmentInOwnerScope(
  db: Dbx,
  ownerId: string,
  workOrderId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), workOrderInOwnerScope(db, ownerId)))
    .limit(1);
  return row !== undefined;
}
