/**
 * Staff reports for a period: rent (expected, collected, outstanding, at risk), expenses by kind
 * and category, occupancy over time, the comparison period and up to 24 monthly buckets, all
 * in one query round trip (four statements run together). Aggregation happens in SQL.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  changePct,
  monthBuckets,
  previousPeriod,
  type ExpenseKind,
  type Period,
  type PlainDate,
} from '@vamar/shared';
import { rowsOf, type Dbx } from '../db.js';

export interface ReportFilters {
  buildingId?: string | undefined;
  unitId?: string | undefined;
  ownerId?: string | undefined;
  categoryId?: string | undefined;
  kind?: ExpenseKind | undefined;
}

export interface RentTotals {
  expectedFils: number;
  collectedFils: number;
  outstandingFils: number;
  atRiskFils: number;
  chequeCount: number;
  bouncedCount: number;
  /** Whole percent of expected that is collected; 0 when nothing was expected. */
  collectionRatePct: number;
}

export interface ExpenseTotalsReport {
  fixedFils: number;
  variableFils: number;
  totalFils: number;
  vatFils: number;
  count: number;
}

export interface ReportBucket extends RentTotals, ExpenseTotalsReport {
  key: string;
  netFils: number;
  /** Units with an active contract on the last day of the month, and the units in scope. */
  occupiedUnits: number;
  totalUnits: number;
}

export interface CategoryTotal {
  categoryId: string;
  nameAr: string;
  nameEn: string;
  kind: ExpenseKind;
  totalFils: number;
  count: number;
}

export interface ReportSummary {
  period: Period;
  comparison: Period | null;
  rent: RentTotals;
  expenses: ExpenseTotalsReport;
  netFils: number;
  previous: { rent: RentTotals; expenses: ExpenseTotalsReport; netFils: number } | null;
  change: {
    expectedPct: number | null;
    collectedPct: number | null;
    expensesPct: number | null;
    netPct: number | null;
  } | null;
  buckets: ReportBucket[];
  byCategory: CategoryTotal[];
  occupancy: { occupiedUnits: number; totalUnits: number; pct: number };
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
  kind: ExpenseKind;
  total: string | number;
  vat: string | number;
  n: number | string;
}
interface CategoryRow {
  category_id: string;
  name_ar: string;
  name_en: string;
  kind: ExpenseKind;
  total: string | number;
  n: number | string;
}
interface OccRow {
  month: string;
  occupied: number | string;
  total: number | string;
}

function emptyRent(): RentTotals {
  return {
    expectedFils: 0,
    collectedFils: 0,
    outstandingFils: 0,
    atRiskFils: 0,
    chequeCount: 0,
    bouncedCount: 0,
    collectionRatePct: 0,
  };
}
function emptyExpenses(): ExpenseTotalsReport {
  return { fixedFils: 0, variableFils: 0, totalFils: 0, vatFils: 0, count: 0 };
}
function addRent(t: RentTotals, r: RentRow) {
  t.expectedFils += Number(r.expected);
  t.collectedFils += Number(r.collected);
  t.atRiskFils += Number(r.at_risk);
  t.chequeCount += Number(r.n);
  t.bouncedCount += Number(r.bounced);
  t.outstandingFils = t.expectedFils - t.collectedFils - t.atRiskFils;
  t.collectionRatePct =
    t.expectedFils === 0 ? 0 : Math.round((100 * t.collectedFils) / t.expectedFils);
}
function addExpense(t: ExpenseTotalsReport, r: ExpenseRow) {
  if (r.kind === 'fixed') t.fixedFils += Number(r.total);
  else t.variableFils += Number(r.total);
  t.totalFils += Number(r.total);
  t.vatFils += Number(r.vat);
  t.count += Number(r.n);
}

/**
 * The scope of a report: every cheque and every expense (staff view) or, with an owner filter,
 * that owner's share of each, using the ownership valid on the cheque's due date or the
 * expense's invoice date.
 */
export async function reportSummary(
  db: Dbx,
  period: Period,
  filters: ReportFilters,
  compare: boolean,
  todayDate: PlainDate,
): Promise<ReportSummary> {
  const prev = compare ? previousPeriod(period) : null;
  const minFrom = prev ? prev.from : period.from;
  const maxTo = period.to;
  const partCase = sql`case when d between ${period.from} and ${period.to} then 'cur' else 'prev' end`;

  const chequeWhere: SQL[] = [];
  if (filters.buildingId) chequeWhere.push(sql`u.building_id = ${filters.buildingId}`);
  if (filters.unitId) chequeWhere.push(sql`c.unit_id = ${filters.unitId}`);
  const expenseWhere: SQL[] = [];
  if (filters.buildingId) expenseWhere.push(sql`x.building_id = ${filters.buildingId}`);
  if (filters.unitId) expenseWhere.push(sql`a.unit_id = ${filters.unitId}`);
  if (filters.categoryId) expenseWhere.push(sql`x.category_id = ${filters.categoryId}`);
  if (filters.kind) expenseWhere.push(sql`x.kind = ${filters.kind}`);
  const andAll = (parts: SQL[]) =>
    parts.length ? sql` and ${sql.join(parts, sql` and `)}` : sql``;

  // Rent: the owner's share when an owner is given, otherwise the gross cheque.
  const rentQ = db.execute(sql`
    with mine as (
      select q.due_date as d, q.status,
             ${
               filters.ownerId
                 ? sql`(q.amount_fils * uo.share_bp / 10000)::bigint`
                 : sql`q.amount_fils`
             } as fils
      from cheques q
      join contracts c on c.id = q.contract_id and c.status <> 'draft'
      join units u on u.id = c.unit_id
      ${
        filters.ownerId
          ? sql`join unit_ownerships uo on uo.unit_id = c.unit_id and uo.owner_id = ${filters.ownerId}
                and uo.from_date <= q.due_date and (uo.to_date is null or uo.to_date > q.due_date)`
          : sql``
      }
      where q.amount_fils is not null and q.status not in ('replaced', 'cancelled')
        and q.due_date between ${minFrom} and ${maxTo}${andAll(chequeWhere)}
    )
    select ${partCase} as part, to_char(d, 'YYYY-MM') as month,
           coalesce(sum(fils), 0)::bigint as expected,
           coalesce(sum(fils) filter (where status = 'cleared'), 0)::bigint as collected,
           coalesce(sum(fils) filter (where status = 'bounced'), 0)::bigint as at_risk,
           count(*)::int as n, count(*) filter (where status = 'bounced')::int as bounced
    from mine group by 1, 2`);

  // Expenses, posted only. With an owner or a unit filter the figures are shares, so they come from
  // the allocations (indexed by owner and date, unit and date). Without one, every allocation of an
  // expense adds back up to the expense (largest remainder), so the expense rows themselves give
  // the same totals: a scan of the expenses by status and invoice date instead of joining over a
  // million allocation rows (which ran Postgres out of shared memory on the load dataset).
  const byShare = Boolean(filters.ownerId ?? filters.unitId);
  const expenseQ = byShare
    ? db.execute(sql`
    with mine as (
      select a.on_date as d, x.kind, a.amount_fils as fils, x.id as xid,
             (a.amount_fils::numeric * x.vat_fils / nullif(x.total_fils, 0)) as vat
      from expense_allocations a
      join expenses x on x.id = a.expense_id and x.status = 'posted'
      where a.on_date between ${minFrom} and ${maxTo}
        ${filters.ownerId ? sql`and a.owner_id = ${filters.ownerId} and x.visible_to_owner` : sql``}
        ${andAll(expenseWhere)}
    )
    select ${partCase} as part, to_char(d, 'YYYY-MM') as month, kind,
           coalesce(sum(fils), 0)::bigint as total, coalesce(round(sum(vat)), 0)::bigint as vat,
           count(distinct xid)::int as n
    from mine group by 1, 2, 3`)
    : db.execute(sql`
    select ${sql`case when x.invoice_date between ${period.from} and ${period.to} then 'cur' else 'prev' end`} as part,
           to_char(x.invoice_date, 'YYYY-MM') as month, x.kind,
           coalesce(sum(x.total_fils), 0)::bigint as total, coalesce(sum(x.vat_fils), 0)::bigint as vat,
           count(*)::int as n
    from expenses x
    where x.status = 'posted' and x.invoice_date between ${minFrom} and ${maxTo}${andAll(expenseWhere)}
    group by 1, 2, 3`);

  const categoryQ = byShare
    ? db.execute(sql`
    select x.category_id, k.name_ar, k.name_en, k.kind,
           coalesce(sum(a.amount_fils), 0)::bigint as total, count(distinct x.id)::int as n
    from expense_allocations a
    join expenses x on x.id = a.expense_id and x.status = 'posted'
    join expense_categories k on k.id = x.category_id
    where a.on_date between ${period.from} and ${period.to}
      ${filters.ownerId ? sql`and a.owner_id = ${filters.ownerId} and x.visible_to_owner` : sql``}
      ${andAll(expenseWhere)}
    group by 1, 2, 3, 4 order by total desc`)
    : db.execute(sql`
    select x.category_id, k.name_ar, k.name_en, k.kind,
           coalesce(sum(x.total_fils), 0)::bigint as total, count(*)::int as n
    from expenses x
    join expense_categories k on k.id = x.category_id
    where x.status = 'posted' and x.invoice_date between ${period.from} and ${period.to}${andAll(expenseWhere)}
    group by 1, 2, 3, 4 order by total desc`);

  // Occupancy at each month end of the period, over the units in scope.
  const unitScope: SQL[] = [sql`u.active`];
  if (filters.buildingId) unitScope.push(sql`u.building_id = ${filters.buildingId}`);
  if (filters.unitId) unitScope.push(sql`u.id = ${filters.unitId}`);
  if (filters.ownerId)
    unitScope.push(
      sql`exists (select 1 from unit_ownerships uo where uo.unit_id = u.id and uo.owner_id = ${filters.ownerId} and uo.to_date is null)`,
    );
  const occQ = db.execute(sql`
    with months as (
      -- One row per calendar month the period touches (a period starting on the 20th still gets
      -- its last month); each is measured on its last day, clipped to the period's end.
      select least((gs + interval '1 month - 1 day')::date, ${period.to}::date) as month_end
      from generate_series(date_trunc('month', ${period.from}::date), ${period.to}::date, interval '1 month') gs
    ),
    scope as (select u.id from units u where ${sql.join(unitScope, sql` and `)}),
    total as (select count(*)::int as n from scope)
    -- Each month joins the contracts that ran on its end day (one pass over contracts per month)
    -- instead of probing every unit for every month; a unit with two such contracts counts once.
    select to_char(m.month_end, 'YYYY-MM') as month,
           count(distinct c.unit_id)::int as occupied,
           (select n from total) as total
    from months m
    left join contracts c
      on c.status in ('active', 'expired', 'renewed', 'terminated')
     and c.start_date <= least(m.month_end, ${todayDate}::date) and c.end_date >= least(m.month_end, ${todayDate}::date)
     and (c.status = 'active' or c.end_date < ${todayDate}::date)
     and c.unit_id in (select id from scope)
    group by 1`);

  const [rentRaw, expenseRaw, categoryRaw, occRaw] = await Promise.all([
    rentQ,
    expenseQ,
    categoryQ,
    occQ,
  ]);
  const rentRows = rowsOf<RentRow>(rentRaw);
  const expenseRows = rowsOf<ExpenseRow>(expenseRaw);
  const categoryRows = rowsOf<CategoryRow>(categoryRaw);
  const occRows = rowsOf<OccRow>(occRaw);

  const rent = emptyRent();
  const expenses = emptyExpenses();
  const prevRent = emptyRent();
  const prevExpenses = emptyExpenses();
  const keys = monthBuckets(period).map((b) => b.key);
  const buckets = new Map<string, ReportBucket>(
    keys.map((key) => [
      key,
      { key, ...emptyRent(), ...emptyExpenses(), netFils: 0, occupiedUnits: 0, totalUnits: 0 },
    ]),
  );
  for (const r of rentRows) {
    if (r.part === 'cur') {
      addRent(rent, r);
      const b = buckets.get(r.month);
      if (b) addRent(b, r);
    } else addRent(prevRent, r);
  }
  for (const r of expenseRows) {
    if (r.part === 'cur') {
      addExpense(expenses, r);
      const b = buckets.get(r.month);
      if (b) addExpense(b, r);
    } else addExpense(prevExpenses, r);
  }
  let occupancy = { occupiedUnits: 0, totalUnits: 0, pct: 0 };
  for (const r of occRows) {
    const b = buckets.get(r.month);
    if (b) {
      b.occupiedUnits = Number(r.occupied);
      b.totalUnits = Number(r.total);
    }
  }
  const lastBucket = [...buckets.values()].at(-1);
  if (lastBucket) {
    occupancy = {
      occupiedUnits: lastBucket.occupiedUnits,
      totalUnits: lastBucket.totalUnits,
      pct:
        lastBucket.totalUnits === 0
          ? 0
          : Math.round((100 * lastBucket.occupiedUnits) / lastBucket.totalUnits),
    };
  }
  for (const b of buckets.values()) b.netFils = b.collectedFils - b.totalFils;
  const netFils = rent.collectedFils - expenses.totalFils;
  const prevNet = prevRent.collectedFils - prevExpenses.totalFils;
  return {
    period,
    comparison: prev,
    rent,
    expenses,
    netFils,
    previous: prev ? { rent: prevRent, expenses: prevExpenses, netFils: prevNet } : null,
    change: prev
      ? {
          expectedPct: changePct(rent.expectedFils, prevRent.expectedFils),
          collectedPct: changePct(rent.collectedFils, prevRent.collectedFils),
          expensesPct: changePct(expenses.totalFils, prevExpenses.totalFils),
          netPct: changePct(netFils, prevNet),
        }
      : null,
    buckets: [...buckets.values()],
    byCategory: categoryRows.map((r) => ({
      categoryId: r.category_id,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      kind: r.kind,
      totalFils: Number(r.total),
      count: Number(r.n),
    })),
    occupancy,
  };
}
