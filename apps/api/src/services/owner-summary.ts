/**
 * The owner's summary for a period: rent (expected, collected, outstanding, at risk), expenses
 * (fixed and variable, actual and projected), net and projected net, the comparison period and
 * monthly buckets, plus the rows Home shows under the cards. Two statements run together: one
 * round trip of latency. Shares follow the ownership valid on each cheque's due date and each
 * expense's invoice date.
 */
import { sql, type SQL } from 'drizzle-orm';
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
  type AllocationMethod,
  type ChequeStatus,
  type Period,
  type PeriodPreset,
  type PlainDate,
  type WeekStart,
} from '@vamar/shared';
import { rowsOf, type Dbx } from '../db.js';
import {
  buildAllocationUnits,
  type AllocationOwnershipRow,
  type AllocationUnitRow,
} from './expenses.js';

const { disputes } = schema;

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

interface Figures {
  rent: RentRow[];
  spent: ExpenseRow[];
  next: {
    id: string;
    dueDate: string;
    amountFils: number | null;
    shareBp: number;
    status: ChequeStatus;
    unitNo: string;
    buildingNameAr: string;
    buildingNameEn: string;
    tenantName: string;
  } | null;
  ending: OwnerSummary['contractsEnding'];
  counts: {
    open_work_orders: number | string;
    open_disputes: number | string;
    total_units: number | string;
    occupied_units: number | string;
  };
}

interface Projection {
  rules: {
    id: string;
    scope: 'building' | 'unit';
    buildingId: string;
    unitId: string | null;
    frequency: 'monthly' | 'quarterly' | 'yearly';
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    amountFils: number;
    vatFils: number;
    allocationMethod: AllocationMethod;
    active: boolean;
  }[];
  units: AllocationUnitRow[];
  ownerships: AllocationOwnershipRow[];
}

/** One JSON column of a one-row result (pg and PGlite parse json, some drivers return text). */
function jsonColumn(result: unknown, column: string): unknown {
  const row = rowsOf<Record<string, unknown>>(result)[0];
  const value = row?.[column];
  if (value === undefined || value === null) throw new Error(`summary query returned no ${column}`);
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
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

  // The owner's current units in the requested scope: next cheque, contracts ending, counts.
  const scopeUnitsSql = sql`
    select uo.unit_id, uo.share_bp from unit_ownerships uo join units u on u.id = uo.unit_id
    where uo.owner_id = ${ownerId} and uo.to_date is null
      ${q.buildingId ? sql`and u.building_id = ${q.buildingId}` : sql``}
      ${q.unitId ? sql`and u.id = ${q.unitId}` : sql``}`;

  // Statement 1: every figure and list of the screen as one JSON document, so a summary costs one
  // round trip (one pooled connection locally, one HTTPS request on Neon) instead of six.
  const figuresQ = db.execute(sql`
    with my_units as (${scopeUnitsSql}),
    rent_src as (
      select q.due_date as d, q.status, (q.amount_fils * uo.share_bp / 10000)::bigint as fils
      from cheques q
      join contracts c on c.id = q.contract_id and c.status <> 'draft'
      join units u on u.id = c.unit_id
      join unit_ownerships uo on uo.unit_id = c.unit_id and uo.owner_id = ${ownerId}
           and uo.from_date <= q.due_date and (uo.to_date is null or uo.to_date > q.due_date)
      where q.amount_fils is not null and q.status not in ('replaced', 'cancelled')
        and q.due_date between ${minFrom} and ${period.to}${andAll(chequeWhere)}
    ),
    rent as (
      select ${partCase} as part, to_char(d, 'YYYY-MM') as month,
             coalesce(sum(fils), 0)::bigint as expected,
             coalesce(sum(fils) filter (where status = 'cleared'), 0)::bigint as collected,
             coalesce(sum(fils) filter (where status = 'bounced'), 0)::bigint as at_risk,
             count(*)::int as n, count(*) filter (where status = 'bounced')::int as bounced
      from rent_src group by 1, 2
    ),
    spent_src as (
      select a.on_date as d, x.kind, a.amount_fils as fils, x.id as xid
      from expense_allocations a
      -- One primary-key lookup per allocation row. Written as a joined table, the planner reads
      -- every posted expense (196k rows, 267 ms) to merge with an owner's 20k allocations;
      -- LIMIT 1 keeps this a per-row lookup (id is unique, so the result is the same).
      cross join lateral (
        select e.id, e.kind, e.building_id, e.category_id from expenses e
        where e.id = a.expense_id and e.status = 'posted' and e.visible_to_owner
        limit 1
      ) x
      where a.owner_id = ${ownerId} and a.on_date between ${minFrom} and ${period.to}${andAll(expenseWhere)}
    ),
    spent as (
      select ${partCase} as part, to_char(d, 'YYYY-MM') as month, kind,
             coalesce(sum(fils), 0)::bigint as total, count(distinct xid)::int as n
      from spent_src group by 1, 2, 3
    ),
    next_cheque as (
      select q.id, q.due_date as "dueDate", q.amount_fils as "amountFils", mu.share_bp as "shareBp",
             q.status, u.unit_no as "unitNo", b.name_ar as "buildingNameAr",
             b.name_en as "buildingNameEn", t.name as "tenantName"
      from cheques q
      join contracts c on c.id = q.contract_id and c.status <> 'draft'
      join my_units mu on mu.unit_id = c.unit_id
      join units u on u.id = c.unit_id
      join buildings b on b.id = u.building_id
      join tenants t on t.id = c.tenant_id
      where q.amount_fils is not null and q.status in ('upcoming', 'deposited')
        and q.due_date >= ${todayDate}
      order by q.due_date, q.id limit 1
    ),
    ending as (
      select c.id, u.id as "unitId", u.unit_no as "unitNo", b.name_ar as "buildingNameAr",
             b.name_en as "buildingNameEn", t.name as "tenantName", c.end_date as "endDate"
      from contracts c
      join my_units mu on mu.unit_id = c.unit_id
      join units u on u.id = c.unit_id
      join buildings b on b.id = u.building_id
      join tenants t on t.id = c.tenant_id
      where c.status = 'active' and c.end_date between ${todayDate} and ${addDays(todayDate, 90)}
      order by c.end_date limit 5
    )
    select json_build_object(
      'rent', coalesce((select json_agg(r) from rent r), '[]'::json),
      'spent', coalesce((select json_agg(e) from spent e), '[]'::json),
      'next', (select row_to_json(n) from next_cheque n),
      'ending', coalesce((select json_agg(g order by g."endDate") from ending g), '[]'::json),
      'counts', json_build_object(
        -- The owner's scope for jobs (as workOrderInOwnerScope): on their units, or building-wide in
        -- a building they own in. Counted as two disjoint parts so each uses its own index.
        'open_work_orders', (
          (select count(*)::int from work_orders w where w.visible_to_owner
             and w.status in ('open', 'scheduled', 'in_progress')
             and w.unit_id in (select unit_id from unit_ownerships where owner_id = ${ownerId} and to_date is null))
          + (select count(*)::int from work_orders w where w.visible_to_owner
             and w.status in ('open', 'scheduled', 'in_progress') and w.unit_id is null
             and w.building_id in (select u.building_id from units u where u.id in
               (select unit_id from unit_ownerships where owner_id = ${ownerId} and to_date is null)))),
        'open_disputes', (select count(*)::int from ${disputes} d where d.unit_id in (select unit_id from unit_ownerships where owner_id = ${ownerId} and to_date is null) and d.status <> 'closed'),
        'total_units', (select count(*)::int from my_units),
        'occupied_units', (select count(*)::int from my_units mu where exists (
          select 1 from contracts c where c.unit_id = mu.unit_id and c.status = 'active'
            and c.start_date <= ${todayDate} and c.end_date >= ${todayDate}))
      )
    ) as figures`);

  // Statement 2: the recurring rules that can touch the owner's units and, only when there are
  // some, every unit of the owner's buildings with its owners (a building rule is split over all
  // of them). Projections then allocate in memory, with no query per rule.
  const projectionQ = db.execute(sql`
    with mine as (select unit_id from unit_ownerships where owner_id = ${ownerId} and to_date is null),
    blds as (select distinct u.building_id from units u where u.id in (select unit_id from mine)),
    rules as (
      select r.* from recurring_expense_rules r
      where r.active and r.visible_to_owner and r.start_date <= ${period.to}
        and (r.end_date is null or r.end_date >= ${todayDate})
        and (r.unit_id in (select unit_id from mine)
             or (r.unit_id is null and r.building_id in (select building_id from blds)))
        ${q.buildingId ? sql`and r.building_id = ${q.buildingId}` : sql``}
        ${q.unitId ? sql`and (r.unit_id = ${q.unitId} or r.unit_id is null)` : sql``}
    ),
    su as (select id, size_sqft, building_id, active from units
           where building_id in (select building_id from blds) and exists (select 1 from rules))
    select json_build_object(
      'rules', coalesce((select json_agg(json_build_object(
        'id', id, 'scope', scope, 'buildingId', building_id, 'unitId', unit_id,
        'frequency', frequency, 'dayOfMonth', day_of_month, 'startDate', start_date,
        'endDate', end_date, 'amountFils', amount_fils, 'vatFils', vat_fils,
        'allocationMethod', allocation_method, 'active', active)) from rules), '[]'::json),
      'units', coalesce((select json_agg(json_build_object(
        'id', id, 'sizeSqft', size_sqft, 'buildingId', building_id, 'active', active)) from su), '[]'::json),
      'ownerships', coalesce((select json_agg(json_build_object(
        'unitId', uo.unit_id, 'ownerId', uo.owner_id, 'shareBp', uo.share_bp,
        'fromDate', uo.from_date, 'toDate', uo.to_date))
        from unit_ownerships uo where uo.unit_id in (select id from su)), '[]'::json)
    ) as projection`);

  const [figuresRaw, projectionRaw] = await Promise.all([figuresQ, projectionQ]);
  const figures = jsonColumn(figuresRaw, 'figures') as Figures;
  const projection = jsonColumn(projectionRaw, 'projection') as Projection;
  const rentRaw = figures.rent;
  const expenseRaw = figures.spent;
  const nextRows = figures.next ? [figures.next] : [];
  const ending = figures.ending;
  const countsRaw = [figures.counts];
  const rules = projection.rules;
  const scopeUnits = projection.units;
  const scopeOwnerships = projection.ownerships;

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
      const allocationUnits = buildAllocationUnits(
        scopeUnits,
        scopeOwnerships,
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
