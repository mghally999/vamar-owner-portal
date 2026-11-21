/**
 * The one helper that scopes every owner query. An owner may only see units they currently hold
 * a share in (unit_ownerships with to_date IS NULL), and everything hanging off those units.
 * Cheques also follow the ownership valid on their due date, so a seller keeps the cheques of
 * the time they held the unit (their statements list them).
 * Every owner route must go through these helpers; the isolation test suite proves it.
 */
import { and, eq, exists, isNull, inArray, sql, type SQL } from 'drizzle-orm';
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

/**
 * The unit_ownerships row was valid on the cheque's due date: from_date inclusive, to_date
 * exclusive (a sale on the due date gives that cheque to the buyer). Needs `cheques` and
 * `unit_ownerships` in the query.
 */
export function ownershipOnChequeDueDate(): SQL {
  return sql`(${unitOwnerships.fromDate} <= ${cheques.dueDate} and (${unitOwnerships.toDate} is null or ${unitOwnerships.toDate} > ${cheques.dueDate}))`;
}

/**
 * The unit_ownerships rows of this owner that let them open a cheque on that unit: the share
 * they held on its due date (the period list and the statements), or the share they hold now
 * (the unit screen lists every cheque of the unit).
 */
export function ownershipShowsCheque(ownerId: string): SQL {
  return sql`(${eq(unitOwnerships.ownerId, ownerId)} and (${isNull(unitOwnerships.toDate)} or ${ownershipOnChequeDueDate()}))`;
}

function chequeOwnershipExists(db: Dbx, ownership: SQL) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(contracts)
      .innerJoin(unitOwnerships, eq(unitOwnerships.unitId, contracts.unitId))
      .where(and(eq(contracts.id, cheques.contractId), ownership)),
  );
}

/** The owner held a share of the cheque's unit on its due date (the period list, the calendar). */
export function chequeHeldOnDueDate(db: Dbx, ownerId: string) {
  return chequeOwnershipExists(
    db,
    sql`(${eq(unitOwnerships.ownerId, ownerId)} and ${ownershipOnChequeDueDate()})`,
  );
}

/**
 * Cheques the owner may open (detail, image, message link): held on the due date, or on a unit
 * they hold now. Another owner's cheque, or one due before the owner bought a unit they no
 * longer hold, stays out.
 */
export function chequeInOwnerScope(db: Dbx, ownerId: string) {
  return chequeOwnershipExists(db, ownershipShowsCheque(ownerId));
}

/** `disputes.unit_id IN (owner's units)` */
export function disputeInOwnerScope(db: Dbx, ownerId: string) {
  return inArray(disputes.unitId, ownerUnitsSubquery(db, ownerId));
}
