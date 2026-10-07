/**
 * The one helper that scopes every owner query. An owner may only see units they currently hold
 * a share in (unit_ownerships with to_date IS NULL), and everything hanging off those units.
 * Every owner route must go through these helpers; the isolation test suite proves it.
 */
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { schema } from '@vamar/db';
import type { Dbx } from '../db.js';

const { unitOwnerships, units, contracts, cheques, disputes } = schema;

/** Subquery: ids of the units this owner currently has any share in. */
export function ownerUnitIds(ownerId: string) {
  return {
    unitId: unitOwnerships.unitId,
    where: and(eq(unitOwnerships.ownerId, ownerId), isNull(unitOwnerships.toDate)),
  };
}

export function ownerUnitsSubquery(db: Dbx, ownerId: string) {
  const scope = ownerUnitIds(ownerId);
  return db.select({ unitId: scope.unitId }).from(unitOwnerships).where(scope.where);
}

/** `units.id IN (owner's units)` */
export function unitInOwnerScope(db: Dbx, ownerId: string) {
  return inArray(units.id, ownerUnitsSubquery(db, ownerId));
}

/** `contracts.unit_id IN (owner's units)` */
export function contractInOwnerScope(db: Dbx, ownerId: string) {
  return inArray(contracts.unitId, ownerUnitsSubquery(db, ownerId));
}

/** `cheques.contract_id IN (contracts on owner's units)` */
export function chequeInOwnerScope(db: Dbx, ownerId: string) {
  return inArray(
    cheques.contractId,
    db.select({ id: contracts.id }).from(contracts).where(contractInOwnerScope(db, ownerId)),
  );
}

/** `disputes.unit_id IN (owner's units)` */
export function disputeInOwnerScope(db: Dbx, ownerId: string) {
  return inArray(disputes.unitId, ownerUnitsSubquery(db, ownerId));
}

/** Current share (bp) of this owner in a unit, or null when they hold none. */
export async function ownerShareInUnit(
  db: Dbx,
  ownerId: string,
  unitId: string,
): Promise<number | null> {
  const row = await db.query.unitOwnerships.findFirst({
    where: and(
      eq(unitOwnerships.ownerId, ownerId),
      eq(unitOwnerships.unitId, unitId),
      isNull(unitOwnerships.toDate),
    ),
    columns: { shareBp: true },
  });
  return row?.shareBp ?? null;
}
