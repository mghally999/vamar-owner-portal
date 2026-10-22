import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { addDays, monthRange, type PlainDate } from '@vamar/shared';
import type { Dbx } from '../db.js';
import { bouncedNeedingAction, pendingDueSoon } from './cheques.js';

const { cheques, contracts, units, buildings, tenants, auditLog, owners } = schema;

/** Rows per overview list; the pages behind each list show the rest. */
export const OVERVIEW_LIST_LIMIT = 25;

/**
 * Dashboard overview: this month's money, due in 7 days, contracts ending in 60 days, bounced
 * needing action. The six queries are independent and run together, so the screen costs one
 * round trip of latency instead of six.
 */
export async function overview(db: Dbx, todayDate: PlainDate) {
  const [y, m] = todayDate.split('-').map(Number) as [number, number];
  const range = monthRange(y, m);
  const totalsQ = db
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

  const endingSoonQ = db
    .select({
      id: contracts.id,
      endDate: contracts.endDate,
      annualRentFils: contracts.annualRentFils,
      unitId: units.id,
      unitNo: units.unitNo,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
      hasRenewalDraft: sql<boolean>`exists (select 1 from ${contracts} r where r.previous_contract_id = contracts.id)`,
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
    .limit(OVERVIEW_LIST_LIMIT);

  // One pass over units joined to the set of currently occupied units (no per-unit subquery).
  const occQ = db.execute(sql`
    select count(*)::int as total, count(occ.unit_id)::int as occupied
    from ${units} u
    left join (
      select distinct c.unit_id from ${contracts} c
      where c.status = 'active' and c.start_date <= ${todayDate} and c.end_date >= ${todayDate}
    ) occ on occ.unit_id = u.id
    where u.active`);

  const deletionRequestsQ = db
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

  const [[totals], endingSoon, occRaw, deletionRequests, dueSoon, bounced] = await Promise.all([
    totalsQ,
    endingSoonQ,
    occQ,
    deletionRequestsQ,
    pendingDueSoon(db, todayDate, 7, OVERVIEW_LIST_LIMIT),
    bouncedNeedingAction(db, OVERVIEW_LIST_LIMIT),
  ]);
  // The Neon HTTP driver returns { rows }, pg and PGlite return the rows array itself.
  const occRows = (occRaw as { rows?: unknown[] }).rows ?? (occRaw as unknown as unknown[]);
  const occ = occRows[0] as { total: number | string; occupied: number | string } | undefined;

  return {
    month: todayDate.slice(0, 7),
    expectedFils: Number(totals?.expectedFils ?? 0),
    clearedFils: Number(totals?.clearedFils ?? 0),
    pendingFils: Number(totals?.pendingFils ?? 0),
    bouncedFils: Number(totals?.bouncedFils ?? 0),
    bouncedCount: totals?.bouncedCount ?? 0,
    chequeCount: totals?.chequeCount ?? 0,
    dueSoon,
    endingSoon,
    bounced,
    occupancy: { total: Number(occ?.total ?? 0), occupied: Number(occ?.occupied ?? 0) },
    deletionRequests,
  };
}
