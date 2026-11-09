/**
 * The owner's summary for a period: rent (expected, collected, outstanding, at risk), expenses
 * (fixed and variable, actual and projected), net and projected net, the comparison period and
 * monthly buckets, plus the rows Home shows under the cards. Four statements run together: one
 * round trip of latency. Shares follow the ownership valid on each cheque's due date and each
 * expense's invoice date.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@vamar/db';
import {
  addDays,
  allocateExpense,
  isFuturePeriod,
  monthBuckets,
  previousPeriod,
  projectFixedExpenses,
  recurringDueDates,
  resolvePeriodQuery,
  type ChequeStatus,
  type Period,
  type PeriodPreset,
  type PlainDate,
  type WeekStart,
} from '@vamar/shared';
import { rowsOf, type Dbx } from '../db.js';
import { allocationUnitsFor } from './expenses.js';
import { ownerUnitsSubquery } from './owner-scope.js';
import { workOrderInOwnerScope } from './work-orders.js';

const {
  cheques,
  contracts,
  units,
  buildings,
  tenants,
  disputes,
  workOrders,
  recurringExpenseRules,
  unitOwnerships,
} = schema;

export interface OwnerRent {
  expectedFils: number;
  collectedFils: number;
  outstandingFils: number;
  atRiskFils: number;
  chequeCount: number;
  bouncedCount: number;
}

export interface OwnerExpenseTotals {
  fixedFils: number;
  variableFils: number;
  totalFils: number;
  count: number;
  /** Fixed costs still to come in the period, from the recurring rules. */
  projectedFixedFils: number;
}

export interface OwnerBucket extends OwnerRent, OwnerExpenseTotals {
  key: string;
  netFils: number;
}

export interface OwnerSummary {
  preset: PeriodPreset;
  period: Period;
  comparison: Period | null;
  isFuture: boolean;
  rent: OwnerRent;
  expenses: OwnerExpenseTotals;
  netFils: number;
  projectedNetFils: number;
  previous: { rent: OwnerRent; expenses: OwnerExpenseTotals; netFils: number } | null;
  buckets: OwnerBucket[];
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
  contractsEnding: {
    id: string;
    unitId: string;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    tenantName: string;
    endDate: string;
  }[];
  openWorkOrders: number;
  openDisputes: number;
  occupancy: { occupied: number; total: number; pct: number };
}

interface RentRow {
  part: 'cur' | 'prev';
  month: string;
  expected: string | number;
  collected: string | number;
  at_risk: string | number;
  n: number | string;
  bounced: number | string;
}
interface ExpenseRow {
  part: 'cur' | 'prev';
  month: string;
  kind: 'fixed' | 'variable';
  total: string | number;
  n: number | string;
}

const emptyRent = (): OwnerRent => ({
  expectedFils: 0,
  collectedFils: 0,
  outstandingFils: 0,
  atRiskFils: 0,
  chequeCount: 0,
  bouncedCount: 0,
});
const emptyExpenses = (): OwnerExpenseTotals => ({
  fixedFils: 0,
  variableFils: 0,
  totalFils: 0,
  count: 0,
  projectedFixedFils: 0,
});

function addRent(t: OwnerRent, r: RentRow) {
  t.expectedFils += Number(r.expected);
  t.collectedFils += Number(r.collected);
  t.atRiskFils += Number(r.at_risk);
  t.chequeCount += Number(r.n);
  t.bouncedCount += Number(r.bounced);
  t.outstandingFils = t.expectedFils - t.collectedFils - t.atRiskFils;
}
function addExpense(t: OwnerExpenseTotals, r: ExpenseRow) {
  if (r.kind === 'fixed') t.fixedFils += Number(r.total);
  else t.variableFils += Number(r.total);
  t.totalFils += Number(r.total);
  t.count += Number(r.n);
}

export interface OwnerSummaryQuery {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  buildingId?: string | undefined;
  unitId?: string | undefined;
  compare?: boolean | undefined;
}

export async function ownerSummary(
  db: Dbx,
  ownerId: string,
  q: OwnerSummaryQuery,
  todayDate: PlainDate,
  weekStart: WeekStart,
): Promise<OwnerSummary> {
  const { preset, period } = resolvePeriodQuery(q, todayDate, { weekStart });
  const prev = q.compare ? previousPeriod(period) : null;
  const minFrom = prev ? prev.from : period.from;
  const partCase = sql`case when d between ${period.from} and ${period.to} then 'cur' else 'prev' end`;
  const chequeWhere: SQL[] = [];
  if (q.buildingId) chequeWhere.push(sql`u.building_id = ${q.buildingId}`);
  if (q.unitId) chequeWhere.push(sql`c.unit_id = ${q.unitId}`);
  const expenseWhere: SQL[] = [];
  if (q.buildingId) expenseWhere.push(sql`x.building_id = ${q.buildingId}`);
  if (q.unitId) expenseWhere.push(sql`a.unit_id = ${q.unitId}`);
  const andAll = (parts: SQL[]) =>
    parts.length ? sql` and ${sql.join(parts, sql` and `)}` : sql``;

  const rentQ = db.execute(sql`
    with mine as (
      select q.due_date as d, q.status, (q.amount_fils * uo.share_bp / 10000)::bigint as fils
      from cheques q
      join contracts c on c.id = q.contract_id and c.status <> 'draft'
      join units u on u.id = c.unit_id
      join unit_ownerships uo on uo.unit_id = c.unit_id and uo.owner_id = ${ownerId}
           and uo.from_date <= q.due_date and (uo.to_date is null or uo.to_date > q.due_date)
      where q.amount_fils is not null and q.status not in ('replaced', 'cancelled')
        and q.due_date between ${minFrom} and ${period.to}${andAll(chequeWhere)}
    )
    select ${partCase} as part, to_char(d, 'YYYY-MM') as month,
           coalesce(sum(fils), 0)::bigint as expected,
           coalesce(sum(fils) filter (where status = 'cleared'), 0)::bigint as collected,
           coalesce(sum(fils) filter (where status = 'bounced'), 0)::bigint as at_risk,
           count(*)::int as n, count(*) filter (where status = 'bounced')::int as bounced
    from mine group by 1, 2`);

  const expenseQ = db.execute(sql`
    with mine as (
      select a.on_date as d, x.kind, a.amount_fils as fils, x.id as xid
      from expense_allocations a
      join expenses x on x.id = a.expense_id and x.status = 'posted' and x.visible_to_owner
      where a.owner_id = ${ownerId} and a.on_date between ${minFrom} and ${period.to}${andAll(expenseWhere)}
    )
    select ${partCase} as part, to_char(d, 'YYYY-MM') as month, kind,
           coalesce(sum(fils), 0)::bigint as total, count(distinct xid)::int as n
    from mine group by 1, 2, 3`);

  // Rules that can touch the owner's current units (projections use today's ownership).
  const myUnits = ownerUnitsSubquery(db, ownerId);
  const rulesQ = db
    .select()
    .from(recurringExpenseRules)
    .where(
      and(
        eq(recurringExpenseRules.active, true),
        eq(recurringExpenseRules.visibleToOwner, true),
        lte(recurringExpenseRules.startDate, period.to),
        or(isNull(recurringExpenseRules.endDate), gte(recurringExpenseRules.endDate, todayDate)),
        or(
          inArray(recurringExpenseRules.unitId, myUnits),
          and(
            isNull(recurringExpenseRules.unitId),
            inArray(
              recurringExpenseRules.buildingId,
              db.select({ b: units.buildingId }).from(units).where(inArray(units.id, myUnits)),
            ),
          ),
        ),
        q.buildingId ? eq(recurringExpenseRules.buildingId, q.buildingId) : undefined,
        q.unitId
          ? or(eq(recurringExpenseRules.unitId, q.unitId), isNull(recurringExpenseRules.unitId))
          : undefined,
      ),
    );

  const scopeConditions: SQL[] = [
    eq(unitOwnerships.ownerId, ownerId),
    isNull(unitOwnerships.toDate),
  ];
  if (q.buildingId) scopeConditions.push(eq(units.buildingId, q.buildingId));
  if (q.unitId) scopeConditions.push(eq(units.id, q.unitId));
  const nextChequeQ = db
    .select({
      id: cheques.id,
      dueDate: cheques.dueDate,
      amountFils: cheques.amountFils,
      shareBp: unitOwnerships.shareBp,
      status: cheques.status,
      unitNo: units.unitNo,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
    })
    .from(cheques)
    .innerJoin(contracts, eq(contracts.id, cheques.contractId))
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(unitOwnerships, eq(unitOwnerships.unitId, units.id))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        ...scopeConditions,
        sql`${contracts.status} <> 'draft'`,
        sql`${cheques.amountFils} is not null`,
        inArray(cheques.status, ['upcoming', 'deposited']),
        gte(cheques.dueDate, todayDate),
      ),
    )
    .orderBy(asc(cheques.dueDate), asc(cheques.id))
    .limit(1);
  const endingQ = db
    .select({
      id: contracts.id,
      unitId: units.id,
      unitNo: units.unitNo,
      buildingNameAr: buildings.nameAr,
      buildingNameEn: buildings.nameEn,
      tenantName: tenants.name,
      endDate: contracts.endDate,
    })
    .from(contracts)
    .innerJoin(units, eq(units.id, contracts.unitId))
    .innerJoin(unitOwnerships, eq(unitOwnerships.unitId, units.id))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(
      and(
        ...scopeConditions,
        eq(contracts.status, 'active'),
        gte(contracts.endDate, todayDate),
        lte(contracts.endDate, addDays(todayDate, 90)),
      ),
    )
    .orderBy(asc(contracts.endDate))
    .limit(5);
  const countsQ = db.execute(sql`
    select
      (select count(*)::int from ${workOrders} where ${workOrderInOwnerScope(db, ownerId)} and ${workOrders.status} in ('open', 'scheduled', 'in_progress')) as open_work_orders,
      (select count(*)::int from ${disputes} d where d.unit_id in (select unit_id from unit_ownerships where owner_id = ${ownerId} and to_date is null) and d.status <> 'closed') as open_disputes,
      (select count(*)::int from unit_ownerships uo join units u on u.id = uo.unit_id where uo.owner_id = ${ownerId} and uo.to_date is null ${q.buildingId ? sql`and u.building_id = ${q.buildingId}` : sql``} ${q.unitId ? sql`and u.id = ${q.unitId}` : sql``}) as total_units,
      (select count(*)::int from unit_ownerships uo join units u on u.id = uo.unit_id where uo.owner_id = ${ownerId} and uo.to_date is null ${q.buildingId ? sql`and u.building_id = ${q.buildingId}` : sql``} ${q.unitId ? sql`and u.id = ${q.unitId}` : sql``}
         and exists (select 1 from contracts c where c.unit_id = uo.unit_id and c.status = 'active' and c.start_date <= ${todayDate} and c.end_date >= ${todayDate})) as occupied_units`);

  const [rentRaw, expenseRaw, rules, nextRows, ending, countsRaw] = await Promise.all([
    rentQ,
    expenseQ,
    rulesQ,
    nextChequeQ,
    endingQ,
    countsQ,
  ]);

  const rent = emptyRent();
  const expenses = emptyExpenses();
  const prevRent = emptyRent();
  const prevExpenses = emptyExpenses();
  const buckets = new Map<string, OwnerBucket>(
    monthBuckets(period).map((b) => [
      b.key,
      { key: b.key, ...emptyRent(), ...emptyExpenses(), netFils: 0 },
    ]),
  );
  for (const r of rowsOf<RentRow>(rentRaw)) {
    if (r.part === 'cur') {
      addRent(rent, r);
      const b = buckets.get(r.month);
      if (b) addRent(b, r);
    } else addRent(prevRent, r);
  }
  for (const r of rowsOf<ExpenseRow>(expenseRaw)) {
    if (r.part === 'cur') {
      addExpense(expenses, r);
      const b = buckets.get(r.month);
      if (b) addExpense(b, r);
    } else addExpense(prevExpenses, r);
  }

  // Projections: the owner's part of each future due date of each rule, by month.
  for (const rule of rules) {
    const dates = recurringDueDates(
      {
        frequency: rule.frequency,
        dayOfMonth: rule.dayOfMonth,
        startDate: rule.startDate as PlainDate,
        endDate: rule.endDate as PlainDate | null,
      },
      period,
    ).filter((d) => d > todayDate);
    if (dates.length === 0) continue;
    let mine: number;
    try {
      // Future due dates are split with today's ownership: who will own a unit later is not
      // known yet. Actual expenses and rent always use the ownership valid on their own date.
      const allocationUnits = await allocationUnitsFor(
        db,
        rule.scope,
        rule.buildingId,
        rule.unitId,
        todayDate,
      );
      mine = allocateExpense(rule.amountFils + rule.vatFils, rule.allocationMethod, allocationUnits)
        .filter((a) => a.ownerId === ownerId && (!q.unitId || a.unitId === q.unitId))
        .reduce((acc, a) => acc + a.amountFils, 0);
    } catch {
      continue;
    }
    if (mine === 0) continue;
    const projected = projectFixedExpenses(
      [
        {
          ...rule,
          startDate: rule.startDate as PlainDate,
          endDate: rule.endDate as PlainDate | null,
          amountFils: mine,
          vatFils: 0,
        },
      ],
      period,
      todayDate,
    );
    for (const p of projected) {
      expenses.projectedFixedFils += p.totalFils;
      const b = buckets.get(p.dueDate.slice(0, 7));
      if (b) b.projectedFixedFils += p.totalFils;
    }
  }

  for (const b of buckets.values()) b.netFils = b.collectedFils - b.totalFils;
  const counts = rowsOf<{
    open_work_orders: number | string;
    open_disputes: number | string;
    total_units: number | string;
    occupied_units: number | string;
  }>(countsRaw)[0];
  const total = Number(counts?.total_units ?? 0);
  const occupied = Number(counts?.occupied_units ?? 0);
  const next = nextRows[0];
  return {
    preset,
    period,
    comparison: prev,
    isFuture: isFuturePeriod(period, todayDate),
    rent,
    expenses,
    netFils: rent.collectedFils - expenses.totalFils,
    projectedNetFils: rent.expectedFils - expenses.fixedFils - expenses.projectedFixedFils,
    previous: prev
      ? {
          rent: prevRent,
          expenses: prevExpenses,
          netFils: prevRent.collectedFils - prevExpenses.totalFils,
        }
      : null,
    buckets: [...buckets.values()],
    nextCheque: next
      ? {
          id: next.id,
          dueDate: next.dueDate,
          amountFils: Math.floor(((next.amountFils ?? 0) * next.shareBp) / 10_000),
          unitNo: next.unitNo,
          buildingNameAr: next.buildingNameAr,
          buildingNameEn: next.buildingNameEn,
          tenantName: next.tenantName,
          status: next.status,
        }
      : null,
    contractsEnding: ending,
    openWorkOrders: Number(counts?.open_work_orders ?? 0),
    openDisputes: Number(counts?.open_disputes ?? 0),
    occupancy: { occupied, total, pct: total === 0 ? 0 : Math.round((100 * occupied) / total) },
  };
}
