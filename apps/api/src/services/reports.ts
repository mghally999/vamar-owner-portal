/**
 * Staff reports for a period: rent (expected, collected, outstanding, at risk), expenses by kind
 * and category, occupancy over time, the comparison period and up to 24 monthly buckets, all
 * in one SQL statement (one round trip, one HTTPS request on Neon). Aggregation happens in SQL.
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
import type { Dbx } from '../db.js';
import { jsonColumn } from './owner-summary.js';

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
interface Figures {
  rent: RentRow[];
  expenses: ExpenseRow[];
  categories: CategoryRow[];
  occupancy: OccRow[];
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
  const months = monthBuckets(period);
  // Every row is dated within [minFrom, period.to], so "on or after the period start" is the
  // current period and the rest is the comparison period.
  const isCur = (d: SQL) => sql`${d} >= ${period.from}::date`;

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

  // Rent: the owner's share when an owner is given, otherwise the gross cheque. Summed per due
  // date and status first (one sum per cheque instead of three filtered ones) and named by month
  // after: to_char on every cheque row cost more than the sums.
  const fils = filters.ownerId
    ? sql`(q.amount_fils * uo.share_bp / 10000)::bigint`
    : sql`q.amount_fils`;
  // Without a unit, building or owner filter the contract is only needed to leave out drafts,
  // which an anti-join against the few draft contracts does more cheaply than joining them all.
  const needsContract = Boolean(filters.buildingId ?? filters.unitId ?? filters.ownerId);
  const rentCtes = sql`
    rent_d as (
      select q.due_date as d, q.status, sum(${fils}) as fils, count(*) as n
      from cheques q
      ${
        needsContract
          ? sql`join contracts c on c.id = q.contract_id and c.status <> 'draft'`
          : sql``
      }
      ${filters.buildingId ? sql`join units u on u.id = c.unit_id` : sql``}
      ${
        filters.ownerId
          ? sql`join unit_ownerships uo on uo.unit_id = c.unit_id and uo.owner_id = ${filters.ownerId}
                and uo.from_date <= q.due_date and (uo.to_date is null or uo.to_date > q.due_date)`
          : sql``
      }
      where q.amount_fils is not null and q.status not in ('replaced', 'cancelled')
        and q.due_date between ${minFrom} and ${maxTo}${andAll(chequeWhere)}
        ${
          needsContract
            ? sql``
            : sql`and not exists (select 1 from contracts c
                    where c.id = q.contract_id and c.status = 'draft')`
        }
      group by 1, 2
    ),
    rent as (
      select case when ${isCur(sql`d`)} then 'cur' else 'prev' end as part,
             to_char(d, 'YYYY-MM') as month,
             coalesce(sum(fils), 0)::bigint as expected,
             coalesce(sum(fils) filter (where status = 'cleared'), 0)::bigint as collected,
             coalesce(sum(fils) filter (where status = 'bounced'), 0)::bigint as at_risk,
             sum(n)::int as n, coalesce(sum(n) filter (where status = 'bounced'), 0)::int as bounced
      from rent_d group by 1, 2
    )`;

  // Expenses, posted only, read once for both the monthly figures and the categories.
  // With an owner or a unit filter the figures are shares, so they come from the allocations
  // (indexed by owner and date, unit and date). Without one, every allocation of an expense adds
  // back up to the expense (largest remainder), so the expense rows themselves give the same
  // totals: a scan of the expenses instead of joining over a million allocation rows (which ran
  // Postgres out of shared memory on the load dataset).
  const byShare = Boolean(filters.ownerId ?? filters.unitId);
  // With a building, category or kind filter the matching expenses are few, and a join lets the
  // planner start from them. Without one, one primary-key lookup per allocation row: as a join the
  // planner reads every posted expense to match an owner's few thousand allocations (179 ms
  // against 72 ms for the largest owner; id is unique, so LIMIT 1 changes nothing but the plan).
  const allocationExpense =
    filters.buildingId || filters.categoryId || filters.kind
      ? sql`join expenses x on x.id = a.expense_id and x.status = 'posted'
          ${filters.ownerId ? sql`and x.visible_to_owner` : sql``}`
      : sql`cross join lateral (
          select e.id, e.kind, e.category_id, e.building_id, e.vat_fils, e.total_fils
          from expenses e
          where e.id = a.expense_id and e.status = 'posted'
            ${filters.ownerId ? sql`and e.visible_to_owner` : sql``}
          limit 1
        ) x`;
  const expenseCtes = byShare
    ? sql`
    spent_src as (
      select a.on_date as d, x.kind, x.category_id, a.amount_fils as fils, x.id as xid,
             (a.amount_fils::numeric * x.vat_fils / nullif(x.total_fils, 0)) as vat
      from expense_allocations a
      ${allocationExpense}
      where a.on_date between ${minFrom} and ${maxTo}
        ${filters.ownerId ? sql`and a.owner_id = ${filters.ownerId}` : sql``}
        ${andAll(expenseWhere)}
    ),
    -- Each expense once per period part, month, kind and category: summing these rows gives the
    -- same totals, and counting them the same counts as count(distinct) per month.
    spent_x as (
      select ${isCur(sql`d`)} as cur, date_trunc('month', d::timestamp) as mo, kind, category_id,
             xid, sum(fils) as fils, sum(vat) as vat
      from spent_src group by 1, 2, 3, 4, 5
    ),
    spent as (
      select case when cur then 'cur' else 'prev' end as part, to_char(mo, 'YYYY-MM') as month,
             kind, coalesce(sum(fils), 0)::bigint as total,
             coalesce(round(sum(vat)), 0)::bigint as vat, count(*)::int as n
      from spent_x group by cur, mo, kind
    ),
    cats as (
      select s.category_id, k.name_ar, k.name_en, k.kind,
             coalesce(sum(s.fils), 0)::bigint as total, count(distinct s.xid)::int as n
      from spent_x s
      join expense_categories k on k.id = s.category_id
      where s.cur
      group by 1, 2, 3, 4 order by 1
    )`
    : sql`
    -- Only the current period is split by month and category; the comparison period only ever
    -- gives totals by kind, so its rows get a null month and category. This keeps the groups few
    -- (the planner otherwise expects tens of thousands and sorts every row to disk).
    spent_g as (
      select case when ${isCur(sql`x.invoice_date`)}
                  then date_trunc('month', x.invoice_date::timestamp) end as mo,
             x.kind,
             case when ${isCur(sql`x.invoice_date`)} then x.category_id end as category_id,
             sum(x.total_fils) as total, sum(x.vat_fils) as vat, count(*) as n
      from expenses x
      where x.status = 'posted' and x.invoice_date between ${minFrom} and ${maxTo}${andAll(expenseWhere)}
      group by 1, 2, 3
    ),
    spent as (
      select case when mo is null then 'prev' else 'cur' end as part,
             coalesce(to_char(mo, 'YYYY-MM'), '') as month, kind,
             sum(total)::bigint as total, sum(vat)::bigint as vat, sum(n)::int as n
      from spent_g group by mo, kind
    ),
    cats as (
      select g.category_id, k.name_ar, k.name_en, k.kind,
             sum(g.total)::bigint as total, sum(g.n)::int as n
      from spent_g g
      join expense_categories k on k.id = g.category_id
      group by 1, 2, 3, 4 order by 1
    )`;

  // Occupancy at the end of each bucket month (its last day within the period), measured on
  // today for months not over yet, over the units in scope.
  const unitScope: SQL[] = [sql`u.active`];
  if (filters.buildingId) unitScope.push(sql`u.building_id = ${filters.buildingId}`);
  if (filters.unitId) unitScope.push(sql`u.id = ${filters.unitId}`);
  if (filters.ownerId)
    unitScope.push(
      sql`exists (select 1 from unit_ownerships uo where uo.unit_id = u.id and uo.owner_id = ${filters.ownerId} and uo.to_date is null)`,
    );
  const onDay = (d: PlainDate): PlainDate => (d < todayDate ? d : todayDate);
  const firstDay = onDay(months[0]?.to ?? period.to);
  const lastDay = onDay(months.at(-1)?.to ?? period.to);
  const occCtes = sql`
    months as (
      select * from (values ${sql.join(
        months.map((b) => sql`(${b.key}::text, ${onDay(b.to)}::date)`),
        sql`, `,
      )}) as m(month, on_day)
    ),
    scope as (select u.id from units u where ${sql.join(unitScope, sql` and `)}),
    -- The contracts running on some measured day, read once (as a plain subquery the planner
    -- re-read the contracts and the scope for every month); a unit with two of them counts once.
    live as materialized (
      select c.unit_id, c.start_date, c.end_date from contracts c
      where c.status in ('active', 'expired', 'renewed', 'terminated')
        and (c.status = 'active' or c.end_date < ${todayDate}::date)
        and c.start_date <= ${lastDay}::date and c.end_date >= ${firstDay}::date
        and c.unit_id in (select id from scope)
    ),
    occ as (
      select m.month,
             (select count(distinct l.unit_id) from live l
               where l.start_date <= m.on_day and l.end_date >= m.on_day)::int as occupied,
             (select count(*) from scope)::int as total
      from months m
    )`;

  const figures = jsonColumn(
    await db.execute(sql`
    with ${rentCtes}, ${expenseCtes}, ${occCtes}
    select json_build_object(
      'rent', coalesce((select json_agg(r) from rent r), '[]'::json),
      'expenses', coalesce((select json_agg(e) from spent e), '[]'::json),
      -- Largest first. The rows reach this sort in category order, so equal totals always come
      -- out in the same order.
      'categories', coalesce(
        (select json_agg(c) from (select * from cats order by total desc) c), '[]'::json),
      'occupancy', coalesce((select json_agg(o) from occ o), '[]'::json)
    ) as figures`),
    'figures',
  ) as Figures;
  const rentRows = figures.rent;
  const expenseRows = figures.expenses;
  const categoryRows = figures.categories;
  const occRows = figures.occupancy;

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
