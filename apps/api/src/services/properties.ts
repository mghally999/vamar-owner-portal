import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  validateShares,
  type CreateBuildingInput,
  type CreateUnitInput,
  type PlainDate,
  type SetUnitOwnersInput,
} from '@vamar/shared';
import type { Dbx } from '../db.js';
import type { Patch } from '../util/types.js';
import { ApiError, conflict, notFound } from '../errors.js';
import { audit, type AuditActor } from './audit.js';

const { buildings, units, unitOwnerships, owners, contracts, tenants } = schema;

export async function listBuildings(db: Dbx, todayDate: PlainDate) {
  return db
    .select({
      id: buildings.id,
      nameAr: buildings.nameAr,
      nameEn: buildings.nameEn,
      area: buildings.area,
      address: buildings.address,
      unitCount: sql<number>`(select count(*)::int from ${units} u where u.building_id = ${buildings.id} and u.active)`,
      occupiedCount: sql<number>`(select count(distinct c.unit_id)::int from ${contracts} c join ${units} u on u.id = c.unit_id
        where u.building_id = ${buildings.id} and c.status = 'active' and c.start_date <= ${todayDate} and c.end_date >= ${todayDate})`,
    })
    .from(buildings)
    .orderBy(asc(buildings.nameEn));
}

export async function createBuilding(db: Dbx, actor: AuditActor, input: CreateBuildingInput) {
  const [row] = await db.insert(buildings).values(input).returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'building.create',
    entityType: 'building',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateBuilding(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<CreateBuildingInput>,
) {
  const before = await db.query.buildings.findFirst({ where: eq(buildings.id, id) });
  if (!before) throw notFound('Building');
  const [after] = await db
    .update(buildings)
    .set(clean(patch))
    .where(eq(buildings.id, id))
    .returning();
  await audit(db, actor, {
    action: 'building.update',
    entityType: 'building',
    entityId: id,
    before,
    after,
  });
  return after;
}

/** Building with its units, each unit's current owners and current tenant/contract. */
export async function getBuildingDetail(db: Dbx, id: string, todayDate: PlainDate) {
  const building = await db.query.buildings.findFirst({ where: eq(buildings.id, id) });
  if (!building) throw notFound('Building');
  const unitRows = await db
    .select()
    .from(units)
    .where(eq(units.buildingId, id))
    .orderBy(asc(units.unitNo));
  const unitIds = unitRows.map((u) => u.id);
  const ownerRows = unitIds.length
    ? await db
        .select({
          unitId: unitOwnerships.unitId,
          ownerId: owners.id,
          nameAr: owners.nameAr,
          nameEn: owners.nameEn,
          shareBp: unitOwnerships.shareBp,
        })
        .from(unitOwnerships)
        .innerJoin(owners, eq(owners.id, unitOwnerships.ownerId))
        .where(and(inArray(unitOwnerships.unitId, unitIds), isNull(unitOwnerships.toDate)))
    : [];
  const activeContracts = unitIds.length
    ? await db
        .select({
          id: contracts.id,
          unitId: contracts.unitId,
          startDate: contracts.startDate,
          endDate: contracts.endDate,
          annualRentFils: contracts.annualRentFils,
          status: contracts.status,
          tenantName: tenants.name,
        })
        .from(contracts)
        .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
        .where(and(inArray(contracts.unitId, unitIds), eq(contracts.status, 'active')))
    : [];
  return {
    ...building,
    units: unitRows.map((u) => {
      const contract =
        activeContracts.find(
          (c) => c.unitId === u.id && c.startDate <= todayDate && c.endDate >= todayDate,
        ) ?? null;
      return {
        ...u,
        owners: ownerRows.filter((o) => o.unitId === u.id).map(({ unitId: _u, ...rest }) => rest),
        occupied: contract !== null,
        contract,
      };
    }),
  };
}

export async function createUnit(db: Dbx, actor: AuditActor, input: CreateUnitInput) {
  const building = await db.query.buildings.findFirst({
    where: eq(buildings.id, input.buildingId),
    columns: { id: true },
  });
  if (!building) throw notFound('Building');
  const clash = await db.query.units.findFirst({
    where: and(eq(units.buildingId, input.buildingId), eq(units.unitNo, input.unitNo)),
    columns: { id: true },
  });
  if (clash) throw conflict('A unit with this number already exists in the building');
  const [row] = await db.insert(units).values(input).returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'unit.create',
    entityType: 'unit',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateUnit(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<Omit<CreateUnitInput, 'buildingId'> & { active: boolean }>,
) {
  const before = await db.query.units.findFirst({ where: eq(units.id, id) });
  if (!before) throw notFound('Unit');
  const [after] = await db.update(units).set(clean(patch)).where(eq(units.id, id)).returning();
  await audit(db, actor, {
    action: 'unit.update',
    entityType: 'unit',
    entityId: id,
    before,
    after,
  });
  return after;
}

/**
 * Replace the current owners of a unit. Validated to exactly 100 % inside the transaction;
 * previous ownership rows are closed (to_date = fromDate - 1 day equivalent: we store fromDate
 * of the new set as the close date so history stays contiguous).
 */
export async function setUnitOwners(
  db: Dbx,
  actor: AuditActor,
  unitId: string,
  input: SetUnitOwnersInput,
) {
  const unit = await db.query.units.findFirst({
    where: eq(units.id, unitId),
    columns: { id: true },
  });
  if (!unit) throw notFound('Unit');
  const validation = validateShares(input.owners);
  if (!validation.valid) {
    throw new ApiError(
      422,
      'shares_invalid',
      'Shares must sum to exactly 100% with unique owners',
      validation,
    );
  }
  const ownerRows = await db
    .select({ id: owners.id, status: owners.status })
    .from(owners)
    .where(
      inArray(
        owners.id,
        input.owners.map((o) => o.ownerId),
      ),
    );
  if (ownerRows.length !== input.owners.length) throw notFound('Owner');

  const before = await db
    .select()
    .from(unitOwnerships)
    .where(and(eq(unitOwnerships.unitId, unitId), isNull(unitOwnerships.toDate)));
  if (before.length) {
    await db
      .update(unitOwnerships)
      .set({ toDate: input.fromDate })
      .where(and(eq(unitOwnerships.unitId, unitId), isNull(unitOwnerships.toDate)));
  }
  const after = await db
    .insert(unitOwnerships)
    .values(
      input.owners.map((o) => ({
        unitId,
        ownerId: o.ownerId,
        shareBp: o.shareBp,
        fromDate: input.fromDate,
        toDate: null,
      })),
    )
    .returning();
  await audit(db, actor, {
    action: 'unit.set_owners',
    entityType: 'unit',
    entityId: unitId,
    before,
    after,
  });
  return after;
}

export async function getUnitDetail(db: Dbx, unitId: string) {
  const unit = await db.query.units.findFirst({ where: eq(units.id, unitId) });
  if (!unit) throw notFound('Unit');
  const building = await db.query.buildings.findFirst({ where: eq(buildings.id, unit.buildingId) });
  const currentOwners = await db
    .select({
      ownerId: owners.id,
      nameAr: owners.nameAr,
      nameEn: owners.nameEn,
      shareBp: unitOwnerships.shareBp,
      fromDate: unitOwnerships.fromDate,
    })
    .from(unitOwnerships)
    .innerJoin(owners, eq(owners.id, unitOwnerships.ownerId))
    .where(and(eq(unitOwnerships.unitId, unitId), isNull(unitOwnerships.toDate)));
  const unitContracts = await db
    .select({
      id: contracts.id,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      annualRentFils: contracts.annualRentFils,
      chequeCount: contracts.chequeCount,
      status: contracts.status,
      tenantId: tenants.id,
      tenantName: tenants.name,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(eq(contracts.unitId, unitId))
    .orderBy(sql`${contracts.startDate} desc`);
  return { ...unit, building, owners: currentOwners, contracts: unitContracts };
}

export async function listTenants(db: Dbx, search?: string) {
  const q = db.select().from(tenants);
  const rows = search
    ? await q
        .where(sql`${tenants.name} ilike ${'%' + search + '%'}`)
        .orderBy(asc(tenants.name))
        .limit(50)
    : await q.orderBy(asc(tenants.name)).limit(200);
  return rows;
}

export async function createTenant(db: Dbx, actor: AuditActor, input: typeof tenants.$inferInsert) {
  const [row] = await db.insert(tenants).values(input).returning();
  if (!row) throw new Error('insert failed');
  await audit(db, actor, {
    action: 'tenant.create',
    entityType: 'tenant',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateTenant(
  db: Dbx,
  actor: AuditActor,
  id: string,
  patch: Patch<typeof tenants.$inferInsert>,
) {
  const before = await db.query.tenants.findFirst({ where: eq(tenants.id, id) });
  if (!before) throw notFound('Tenant');
  const [after] = await db.update(tenants).set(clean(patch)).where(eq(tenants.id, id)).returning();
  await audit(db, actor, {
    action: 'tenant.update',
    entityType: 'tenant',
    entityId: id,
    before,
    after,
  });
  return after;
}

function clean<T extends object>(patch: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
