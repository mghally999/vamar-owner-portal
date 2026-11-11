/**
 * Building budgets (v3). An admin sets a yearly amount per building, per expense category and
 * in total; the screens compare it with what was actually posted (the building's full figures,
 * not an owner's share) and with actual plus the fixed costs the recurring rules will still
 * bring this year. Pure functions over integer fils, shared by the API, the dashboard and the app.
 */
import { diffDays, isLeapYear, type PlainDate } from './dates.js';
import { assertFils } from './money.js';
import { projectFixedExpenses, type ProjectableRule } from './expenses.js';
import { yearPeriod, type Period } from './periods.js';

/** Owners and staff hear about a budget line at these percentages of it, once each a year. */
export const BUDGET_THRESHOLDS = [80, 100] as const;
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];

/** `ok` below 80 %, `near` from 80 % up to the budget, `over` at or above it. */
export type BudgetLevel = 'ok' | 'near' | 'over';

/** Budgets are set for calendar years in this range (the period helpers work on any year). */
export const MIN_BUDGET_YEAR = 2020;
export const MAX_BUDGET_YEAR = 2100;

function assertBudget(budgetFils: number): void {
  assertFils(budgetFils, 'budget');
  if (budgetFils <= 0) throw new RangeError('budget must be more than zero');
}

/**
 * Whole percent of the budget used, rounded down, so 79.9 % never shows as 80 % while no alert
 * has gone out. Not capped: an overspent line shows 115 %.
 */
export function budgetPercent(actualFils: number, budgetFils: number): number {
  assertFils(actualFils, 'actual');
  assertBudget(budgetFils);
  if (actualFils <= 0) return 0;
  return Number((BigInt(actualFils) * 100n) / BigInt(budgetFils));
}

/** The highest threshold the actual has reached (at or above), or null below 80 %. */
export function thresholdReached(actualFils: number, budgetFils: number): BudgetThreshold | null {
  assertFils(actualFils, 'actual');
  assertBudget(budgetFils);
  const scaled = BigInt(Math.max(actualFils, 0)) * 100n;
  let reached: BudgetThreshold | null = null;
  for (const t of BUDGET_THRESHOLDS) if (scaled >= BigInt(budgetFils) * BigInt(t)) reached = t;
  return reached;
}

export function budgetLevel(actualFils: number, budgetFils: number): BudgetLevel {
  const t = thresholdReached(actualFils, budgetFils);
  return t === 100 ? 'over' : t === 80 ? 'near' : 'ok';
}

export function budgetYearPeriod(year: number): Period {
  if (!Number.isInteger(year) || year < MIN_BUDGET_YEAR || year > MAX_BUDGET_YEAR)
    throw new RangeError(
      `year must be ${MIN_BUDGET_YEAR}..${MAX_BUDGET_YEAR}, got ${String(year)}`,
    );
  return yearPeriod(year);
}

/**
 * The part of the year already behind us: 1 January to today for the current year, the whole
 * year once it is over, null while it has not started.
 */
export function yearToDate(year: number, today: PlainDate): Period | null {
  const full = budgetYearPeriod(year);
  if (today < full.from) return null;
  return { from: full.from, to: today < full.to ? today : full.to };
}

/**
 * The budget for the days elapsed (today included), in proportion to the days of the year and
 * rounded half up: what "on track" means year to date. A spend that is not even through the year
 * (insurance paid in January) reads ahead of it, which is the honest answer.
 */
export function budgetToDate(budgetFils: number, year: number, today: PlainDate): number {
  assertBudget(budgetFils);
  const ytd = yearToDate(year, today);
  if (!ytd) return 0;
  const days = BigInt(diffDays(ytd.from, ytd.to) + 1);
  const yearDays = BigInt(isLeapYear(year) ? 366 : 365);
  return Number((BigInt(budgetFils) * days * 2n + yearDays) / (yearDays * 2n));
}

export interface BudgetRule extends ProjectableRule {
  categoryId: string;
}

/**
 * Fixed costs the recurring rules will still bring in the year, by category: the building's full
 * amount (amount + VAT) of every due date after today, from `projectFixedExpenses`. A due date
 * that already has an expense (`recorded`, keys `ruleId|date`: a draft or an early posting) is
 * left out so it is not counted twice. Variable costs are never projected.
 */
export function projectedFixedByCategory(
  rules: readonly BudgetRule[],
  year: number,
  today: PlainDate,
  recorded: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const byRule = new Map(rules.map((r) => [r.id, r.categoryId]));
  const out = new Map<string, number>();
  for (const p of projectFixedExpenses(rules, budgetYearPeriod(year), today)) {
    if (recorded.has(`${p.ruleId}|${p.dueDate}`)) continue;
    const categoryId = byRule.get(p.ruleId);
    if (categoryId === undefined) continue;
    out.set(categoryId, (out.get(categoryId) ?? 0) + p.totalFils);
  }
  return out;
}

export interface BudgetRow {
  id: string;
  /** null: the building's total budget. */
  categoryId: string | null;
  amountFils: number;
}

/** Posted expenses of one category in the year: all of them, and those dated up to today. */
export interface CategoryActual {
  categoryId: string;
  yearFils: number;
  toDateFils: number;
}

export interface BudgetLine {
  budgetId: string;
  categoryId: string | null;
  budgetFils: number;
  /** Posted in the year. */
  actualFils: number;
  /** Posted with an invoice date up to today. */
  actualToDateFils: number;
  /** The budget for the days elapsed (see budgetToDate). */
  budgetToDateFils: number;
  /** Fixed costs still due this year from the recurring rules. */
  projectedFils: number;
  /** actual + projected: where the year is heading. */
  forecastFils: number;
  percent: number;
  forecastPercent: number;
  toDatePercent: number;
  level: BudgetLevel;
  forecastLevel: BudgetLevel;
}

/**
 * One line per budget row: a category line counts that category only, the total line counts
 * every category (budgeted or not). Category lines keep the input order; the total comes last.
 */
export function budgetLines(
  budgets: readonly BudgetRow[],
  actuals: readonly CategoryActual[],
  projected: ReadonlyMap<string, number>,
  year: number,
  today: PlainDate,
): BudgetLine[] {
  const sum = (pick: (a: CategoryActual) => number, categoryId: string | null) =>
    actuals
      .filter((a) => categoryId === null || a.categoryId === categoryId)
      .reduce((acc, a) => acc + assertFils(pick(a)), 0);
  const projectedFor = (categoryId: string | null) =>
    categoryId === null
      ? [...projected.values()].reduce((acc, v) => acc + v, 0)
      : (projected.get(categoryId) ?? 0);
  const line = (b: BudgetRow): BudgetLine => {
    const actualFils = sum((a) => a.yearFils, b.categoryId);
    const actualToDateFils = sum((a) => a.toDateFils, b.categoryId);
    const projectedFils = projectedFor(b.categoryId);
    const forecastFils = actualFils + projectedFils;
    const budgetToDateFils = budgetToDate(b.amountFils, year, today);
    return {
      budgetId: b.id,
      categoryId: b.categoryId,
      budgetFils: b.amountFils,
      actualFils,
      actualToDateFils,
      budgetToDateFils,
      projectedFils,
      forecastFils,
      percent: budgetPercent(actualFils, b.amountFils),
      forecastPercent: budgetPercent(forecastFils, b.amountFils),
      toDatePercent: budgetToDateFils > 0 ? budgetPercent(actualToDateFils, budgetToDateFils) : 0,
      level: budgetLevel(actualFils, b.amountFils),
      forecastLevel: budgetLevel(forecastFils, b.amountFils),
    };
  };
  return [
    ...budgets.filter((b) => b.categoryId !== null).map(line),
    ...budgets.filter((b) => b.categoryId === null).map(line),
  ];
}

/**
 * The date slot of a budget alert's dedupe key (`type:ownerId:budgetId:date`). A budget row is
 * one building's line for one year, so the key needs no day; the slot carries the threshold
 * instead, as a fixed day of that year (1 January for 80 %, 31 December for 100 %), which keeps
 * every alert once per line, threshold and owner whatever day the posting happens.
 */
export function budgetAlertKeyDate(year: number, threshold: BudgetThreshold): PlainDate {
  const p = budgetYearPeriod(year);
  return threshold === 80 ? p.from : p.to;
}
