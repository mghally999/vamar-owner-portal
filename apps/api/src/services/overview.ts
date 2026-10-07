import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays, monthRange, type PlainDate } from '@vamar/shared';
import type { Dbx } from '../db.js';
import { bouncedNeedingAction, pendingDueSoon } from './cheques.js';

const { cheques, contracts, units, buildings, tenants, auditLog, owners } = schema;

/** Dashboard overview: this month's money, due in 7 days, contracts ending in 60 days, bounced needing action. */
export async function overview(db: Dbx, todayDate: PlainDate) {
  const [y, m] = todayDate.split('-').map(Number) as [number, number];
  const range = monthRange(y, m);
  const [totals] = await db
    .select({
      expectedFils: sql<string>`coalesce(sum(${cheques.amountFils}) filter (where ${cheques.status} in ('upcoming','deposited','cleared','bounced')), 0)`,
      clearedFils: sql<string>`coalesce(sum(${cheques.amountFils}) filter (where ${cheques.status} = 'cleared'), 0)`,
      pendingFils: sql<string>`coalesce(sum(${cheques.amountFils}) filter (where ${cheques.status} in ('upcoming','deposited')), 0)`,
      bouncedFils: sql<string>`coalesce(sum(${cheques.amountFils}) filter (where ${cheques.status} = 'bounced'), 0)`,
      bouncedCount: sql<number>`count(*) filter (where ${cheques.status} = 'bounced')::int`,
      chequeCount: sql<number>`count(*)::int`,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .where(
      and(
        sql`${cheques.dueDate} between ${range.start} and ${range.end}`,
        sql`${contracts.status} <> 'draft'`,
        sql`${cheques.amountFils} is not null`,
      ),
    );

  const endingSoon = await db
    .select({
      id: contracts.id,
      endDate: contracts.endDate,
      annualRentFils: contracts.annualRentFils,
      unitId: units.id,
      unitNo: units.unitNo,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
      hasRenewalDraft: sql<boolean>`exists (select 1 from ${contracts} r where r.previous_contract_id = ${contracts.id})`,
    })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        eq(contracts.status, 'active'),
        sql`${contracts.endDate} between ${todayDate} and ${addDays(todayDate, 60)}`,
      ),
    )
    .orderBy(contracts.endDate)
    .limit(50);

  const [occ] = await db
    .select({
      total: sql<number>`count(*)::int`,
      occupied: sql<number>`count(*) filter (where exists (select 1 from ${contracts} c where c.unit_id = ${units.id} and c.status = 'active' and c.start_date <= ${todayDate} and c.end_date >= ${todayDate}))::int`,
    })
    .from(units)
    .where(eq(units.active, true));

  const deletionRequests = await db
    .select({
      id: auditLog.id,
      ownerId: auditLog.entityId,
      at: auditLog.at,
      nameEn: owners.nameEn,
      nameAr: owners.nameAr,
      phoneE164: owners.phoneE164,
    })
    .from(auditLog)
    .leftJoin(owners, eq(owners.id, auditLog.entityId))
    .where(eq(auditLog.action, 'owner.delete_requested'))
    .orderBy(desc(auditLog.at))
    .limit(20);

  return {
    month: todayDate.slice(0, 7),
    expectedFils: Number(totals?.expectedFils ?? 0),
    clearedFils: Number(totals?.clearedFils ?? 0),
    pendingFils: Number(totals?.pendingFils ?? 0),
    bouncedFils: Number(totals?.bouncedFils ?? 0),
    bouncedCount: totals?.bouncedCount ?? 0,
    chequeCount: totals?.chequeCount ?? 0,
    dueSoon: await pendingDueSoon(db, todayDate, 7),
    endingSoon,
    bounced: await bouncedNeedingAction(db),
    occupancy: { total: occ?.total ?? 0, occupied: occ?.occupied ?? 0 },
    deletionRequests,
  };
}
