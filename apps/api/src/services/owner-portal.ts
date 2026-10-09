/**
 * Everything the owner app reads. Every query is scoped through owner-scope.ts and amounts are
 * the owner's share (gross, no commission). The home screen is one SQL round trip.
 */
import { and, asc, desc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import { monthRange, ownerShareAmount, type ChequeStatus, type PlainDate } from '@vamar/shared';
import type { Dbx } from '../db.js';
import { notFound } from '../errors.js';
import {
  chequeInOwnerScope,
  contractInOwnerScope,
  disputeInOwnerScope,
  ownerUnitsSubquery,
  unitInOwnerScope,
} from './owner-scope.js';
import { decodeCursor, page } from '../util/pagination.js';

const {
  cheques,
  contracts,
  units,
  buildings,
  tenants,
  unitOwnerships,
  disputes,
  disputeUpdates,
  chequeEvents,
  owners,
} = schema;

export interface OwnerHome {
  month: string;
  expectedFils: number;
  clearedFils: number;
  pendingFils: number;
  bouncedCount: number;
  bouncedFils: number;
  nextCheque: {
    id: string;
    dueDate: string;
    amountFils: number;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    tenantName: string;
    status: ChequeStatus;
  } | null;
  nextMonthFils: number;
  occupancy: { occupied: number; total: number; pct: number };
  vacantUnits: {
    unitId: string;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    vacantSince: string | null;
  }[];
  openDisputes: number;
}

/**
 * One round trip: CTEs compute the owner's units with share, the month's cheques with the
 * owner's share applied, occupancy, vacant units and the open dispute count, returned as JSON.
 */
type Money = string | number; // bigint columns arrive as strings in JSON
interface RawHome extends Omit<
  OwnerHome,
  'expectedFils' | 'clearedFils' | 'pendingFils' | 'bouncedFils' | 'nextMonthFils' | 'nextCheque'
> {
  expectedFils: Money;
  clearedFils: Money;
  pendingFils: Money;
  bouncedFils: Money;
  nextMonthFils: Money;
  nextCheque:
    (Omit<NonNullable<OwnerHome['nextCheque']>, 'amountFils'> & { amountFils: Money }) | null;
}

export async function ownerHome(
  db: Dbx,
  ownerId: string,
  month: string,
  todayDate: PlainDate,
): Promise<OwnerHome> {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const range = monthRange(y, m);
  const nextRange = monthRange(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- execute() on the generic Db returns unknown
  const result = (await db.execute(sql`
    with my_units as (
      select uo.unit_id, uo.share_bp
      from unit_ownerships uo
      where uo.owner_id = ${ownerId} and uo.to_date is null
    ),
    my_cheques as (
      select q.id, q.due_date, q.status,
             (q.amount_fils * mu.share_bp / 10000)::bigint as share_fils,
             u.unit_no, b.name_ar as building_name_ar, b.name_en as building_name_en, t.name as tenant_name
      from cheques q
      join contracts c on c.id = q.contract_id and c.status <> 'draft'
      join my_units mu on mu.unit_id = c.unit_id
      join units u on u.id = c.unit_id
      join buildings b on b.id = u.building_id
      join tenants t on t.id = c.tenant_id
      where q.amount_fils is not null
    ),
    month_cheques as (
      select * from my_cheques where due_date between ${range.start} and ${range.end}
    ),
    totals as (
      select
        coalesce(sum(share_fils) filter (where status in ('upcoming','deposited','cleared','bounced')), 0)::bigint as expected,
        coalesce(sum(share_fils) filter (where status = 'cleared'), 0)::bigint as cleared,
        coalesce(sum(share_fils) filter (where status in ('upcoming','deposited')), 0)::bigint as pending,
        count(*) filter (where status = 'bounced')::int as bounced_count,
        coalesce(sum(share_fils) filter (where status = 'bounced'), 0)::bigint as bounced
      from month_cheques
    ),
    next_cheque as (
      select id, due_date, share_fils, unit_no, building_name_ar, building_name_en, tenant_name, status
      from my_cheques
      where status in ('upcoming','deposited') and due_date >= ${todayDate}
      order by due_date, id limit 1
    ),
    next_month as (
      select coalesce(sum(share_fils) filter (where status in ('upcoming','deposited','cleared','bounced')), 0)::bigint as total
      from my_cheques where due_date between ${nextRange.start} and ${nextRange.end}
    ),
    occ as (
      select mu.unit_id,
             exists (select 1 from contracts c where c.unit_id = mu.unit_id and c.status = 'active'
                     and c.start_date <= ${todayDate} and c.end_date >= ${todayDate}) as occupied,
             (select max(c.end_date) from contracts c where c.unit_id = mu.unit_id and c.status <> 'draft' and c.end_date < ${todayDate}) as vacant_since
      from my_units mu
    ),
    vacant as (
      select o.unit_id, u.unit_no, b.name_ar, b.name_en, o.vacant_since
      from occ o join units u on u.id = o.unit_id join buildings b on b.id = u.building_id
      where not o.occupied order by b.name_en, u.unit_no
    ),
    disputes_open as (
      select count(*)::int as n from disputes d join my_units mu on mu.unit_id = d.unit_id where d.status <> 'closed'
    )
    select json_build_object(
      'month', ${month}::text,
      'expectedFils', (select expected from totals),
      'clearedFils', (select cleared from totals),
      'pendingFils', (select pending from totals),
      'bouncedCount', (select bounced_count from totals),
      'bouncedFils', (select bounced from totals),
      'nextCheque', (select json_build_object('id', id, 'dueDate', due_date, 'amountFils', share_fils, 'unitNo', unit_no,
                      'buildingNameAr', building_name_ar, 'buildingNameEn', building_name_en, 'tenantName', tenant_name, 'status', status) from next_cheque),
      'nextMonthFils', (select total from next_month),
      'occupancy', json_build_object(
        'occupied', (select count(*) filter (where occupied) from occ)::int,
        'total', (select count(*) from occ)::int,
        'pct', case when (select count(*) from occ) = 0 then 0
                    else round(100.0 * (select count(*) filter (where occupied) from occ) / (select count(*) from occ))::int end),
      'vacantUnits', coalesce((select json_agg(json_build_object('unitId', unit_id, 'unitNo', unit_no, 'buildingNameAr', name_ar,
                      'buildingNameEn', name_en, 'vacantSince', vacant_since)) from vacant), '[]'::json),
      'openDisputes', (select n from disputes_open)
    ) as home
  `)) as unknown as { rows: { home: RawHome | string }[] };
  const row = result.rows[0];
  if (!row) throw new Error('home query returned nothing');
  const home = typeof row.home === 'string' ? (JSON.parse(row.home) as RawHome) : row.home;
  return {
    ...home,
    expectedFils: Number(home.expectedFils),
    clearedFils: Number(home.clearedFils),
    pendingFils: Number(home.pendingFils),
    bouncedFils: Number(home.bouncedFils),
    nextMonthFils: Number(home.nextMonthFils),
    nextCheque: home.nextCheque
      ? { ...home.nextCheque, amountFils: Number(home.nextCheque.amountFils) }
      : null,
  };
}

export interface OwnerChequeQuery {
  month?: string | undefined;
  buildingId?: string | undefined;
  unitId?: string | undefined;
  status?: ChequeStatus[] | undefined;
  cursor?: string | undefined;
  limit: number;
}

const ownerChequeSelect = {
  id: cheques.id,
  seq: cheques.seq,
  dueDate: cheques.dueDate,
  grossAmountFils: cheques.amountFils,
  shareBp: unitOwnerships.shareBp,
  chequeNo: cheques.chequeNo,
  bankName: cheques.bankName,
  status: cheques.status,
  statusChangedAt: cheques.statusChangedAt,
  bounceReason: cheques.bounceReason,
  hasImage: sql<boolean>`${cheques.imageKey} is not null`,
  unitId: units.id,
  unitNo: units.unitNo,
  buildingId: buildings.id,
  buildingNameAr: buildings.nameAr,
  buildingNameEn: buildings.nameEn,
  tenantName: tenants.name,
  contractId: contracts.id,
};

function withShare<T extends { grossAmountFils: number | null; shareBp: number }>(row: T) {
  return {
    ...row,
    amountFils:
      row.grossAmountFils === null ? null : ownerShareAmount(row.grossAmountFils, row.shareBp),
    shared: row.shareBp < 10_000,
  };
}

export async function ownerCheques(db: Dbx, ownerId: string, q: OwnerChequeQuery) {
  const cursor = decodeCursor(q.cursor);
  const conditions: (SQL | undefined)[] = [
    eq(unitOwnerships.ownerId, ownerId),
    isNull(unitOwnerships.toDate),
    sql`${contracts.status} <> 'draft'`,
    sql`${cheques.amountFils} is not null`,
  ];
  if (q.month) {
    const [y, m] = q.month.split('-').map(Number) as [number, number];
    const r = monthRange(y, m);
    conditions.push(sql`${cheques.dueDate} between ${r.start} and ${r.end}`);
  }
  if (q.buildingId) conditions.push(eq(units.buildingId, q.buildingId));
  if (q.unitId) conditions.push(eq(units.id, q.unitId));
  if (q.status?.length) conditions.push(inArray(cheques.status, q.status));
  if (cursor)
    conditions.push(
      or(
        gt(cheques.dueDate, cursor.key),
        and(eq(cheques.dueDate, cursor.key), gt(cheques.id, cursor.id)),
      ),
    );
  const rows = await db
    .select(ownerChequeSelect)
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(unitOwnerships, eq(unitOwnerships.unitId, units.id))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(...conditions))
    .orderBy(asc(cheques.dueDate), asc(cheques.id))
    .limit(q.limit + 1);
  const p = page(rows, q.limit, (r) => ({ key: r.dueDate, id: r.id }));
  return { items: p.items.map(withShare), nextCursor: p.nextCursor };
}

export async function ownerChequeDetail(db: Dbx, ownerId: string, chequeId: string) {
  const [row] = await db
    .select({ ...ownerChequeSelect, imageKey: cheques.imageKey })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(
      unitOwnerships,
      and(
        eq(unitOwnerships.unitId, units.id),
        eq(unitOwnerships.ownerId, ownerId),
        isNull(unitOwnerships.toDate),
      ),
    )
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        eq(cheques.id, chequeId),
        chequeInOwnerScope(db, ownerId),
        sql`${contracts.status} <> 'draft'`,
      ),
    );
  if (!row) throw notFound('Cheque');
  const timeline = await db
    .select({
      id: chequeEvents.id,
      fromStatus: chequeEvents.fromStatus,
      toStatus: chequeEvents.toStatus,
      at: chequeEvents.at,
    })
    .from(chequeEvents)
    .where(eq(chequeEvents.chequeId, chequeId))
    .orderBy(asc(chequeEvents.at), asc(chequeEvents.id));
  const { imageKey, ...rest } = row;
  return { ...withShare(rest), hasImage: imageKey !== null, timeline };
}

/** Buildings the owner has units in, with occupancy per building. */
export async function ownerBuildings(db: Dbx, ownerId: string, todayDate: PlainDate) {
  const rows = await db
    .select({
      id: buildings.id,
      nameAr: buildings.nameAr,
      nameEn: buildings.nameEn,
      area: buildings.area,
      unitCount: sql<number>`count(distinct ${units.id})::int`,
      occupiedCount: sql<number>`count(distinct ${units.id}) filter (where exists (
        select 1 from ${contracts} c where c.unit_id = units.id and c.status = 'active'
        and c.start_date <= ${todayDate} and c.end_date >= ${todayDate}))::int`,
    })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(unitInOwnerScope(db, ownerId))
    .groupBy(buildings.id)
    .orderBy(asc(buildings.nameEn));
  return rows;
}

export async function ownerUnits(
  db: Dbx,
  ownerId: string,
  todayDate: PlainDate,
  buildingId?: string,
) {
  const conditions: SQL[] = [
    unitInOwnerScope(db, ownerId),
    eq(unitOwnerships.ownerId, ownerId),
    isNull(unitOwnerships.toDate),
  ];
  if (buildingId) conditions.push(eq(units.buildingId, buildingId));
  const rows = await db
    .select({
      id: units.id,
      unitNo: units.unitNo,
      type: units.type,
      bedrooms: units.bedrooms,
      sizeSqft: units.sizeSqft,
      shareBp: unitOwnerships.shareBp,
      buildingId: buildings.id,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      contractId: contracts.id,
      tenantName: tenants.name,
      contractEndDate: contracts.endDate,
      annualRentFils: contracts.annualRentFils,
      vacantSince: sql<
        string | null
      >`(select max(c2.end_date) from ${contracts} c2 where c2.unit_id = units.id and c2.status <> 'draft' and c2.end_date < ${todayDate})`,
    })
    .from(units)
    .innerJoin(unitOwnerships, eq(unitOwnerships.unitId, units.id))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(
      contracts,
      and(
        eq(contracts.unitId, units.id),
        eq(contracts.status, 'active'),
        sql`${contracts.startDate} <= ${todayDate} and ${contracts.endDate} >= ${todayDate}`,
      ),
    )
    .leftJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(...conditions))
    .orderBy(asc(buildings.nameEn), asc(units.unitNo));
  return rows.map((r) => ({
    ...r,
    occupied: r.contractId !== null,
    annualRentFils:
      r.annualRentFils === null ? null : ownerShareAmount(r.annualRentFils, r.shareBp),
  }));
}

export async function ownerUnitDetail(
  db: Dbx,
  ownerId: string,
  unitId: string,
  todayDate: PlainDate,
) {
  const [unit] = await ownerUnits(db, ownerId, todayDate).then((rows) =>
    rows.filter((u) => u.id === unitId),
  );
  if (!unit) throw notFound('Unit');
  const unitContracts = await db
    .select({
      id: contracts.id,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      annualRentFils: contracts.annualRentFils,
      chequeCount: contracts.chequeCount,
      status: contracts.status,
      tenantName: tenants.name,
    })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        eq(contracts.unitId, unitId),
        contractInOwnerScope(db, ownerId),
        sql`${contracts.status} <> 'draft'`,
      ),
    )
    .orderBy(desc(contracts.startDate));
  const unitCheques = await ownerCheques(db, ownerId, { unitId, limit: 100 });
  return {
    ...unit,
    contracts: unitContracts.map((c) => ({
      ...c,
      annualRentFils: ownerShareAmount(c.annualRentFils, unit.shareBp),
    })),
    cheques: unitCheques.items,
  };
}

export async function ownerDisputes(db: Dbx, ownerId: string) {
  return db
    .select({
      id: disputes.id,
      caseNo: disputes.caseNo,
      type: disputes.type,
      status: disputes.status,
      amountClaimedFils: disputes.amountClaimedFils,
      nextHearingDate: disputes.nextHearingDate,
      openedAt: disputes.openedAt,
      closedAt: disputes.closedAt,
      unitId: units.id,
      unitNo: units.unitNo,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
    })
    .from(disputes)
    .innerJoin(units, eq(units.id, disputes.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(tenants, eq(tenants.id, disputes.tenantId))
    .where(disputeInOwnerScope(db, ownerId))
    .orderBy(desc(disputes.openedAt));
}

export async function ownerDisputeDetail(db: Dbx, ownerId: string, disputeId: string) {
  const list = await ownerDisputes(db, ownerId);
  const dispute = list.find((d) => d.id === disputeId);
  if (!dispute) throw notFound('Dispute');
  const updates = await db
    .select({ id: disputeUpdates.id, note: disputeUpdates.note, at: disputeUpdates.at })
    .from(disputeUpdates)
    .where(and(eq(disputeUpdates.disputeId, disputeId), eq(disputeUpdates.visibleToOwner, true)))
    .orderBy(desc(disputeUpdates.at));
  return { ...dispute, updates };
}

export async function ownerProfile(db: Dbx, ownerId: string) {
  const owner = await db.query.owners.findFirst({
    where: eq(owners.id, ownerId),
    columns: {
      id: true,
      nameAr: true,
      nameEn: true,
      phoneE164: true,
      email: true,
      preferredLang: true,
      status: true,
    },
  });
  if (!owner) throw notFound('Owner');
  return owner;
}

export { ownerUnitsSubquery };
