/**
 * Expenses (v2 business rules): kinds and statuses, VAT, the allocation of a building or unit
 * expense to its owners, and recurring rules for fixed costs. Pure functions over integer fils;
 * every split uses the largest-remainder method so the parts always add up to the total.
 */
import { addMonthsClamped, daysInMonth, fromParts, lastDayOfMonth, toParts } from './dates.js';
import type { PlainDate } from './dates.js';
import { assertFils } from './money.js';
import type { Period } from './periods.js';

export const EXPENSE_KINDS = ['fixed', 'variable'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const EXPENSE_SCOPES = ['building', 'unit'] as const;
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number];

export const EXPENSE_STATUSES = ['draft', 'posted', 'void'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'cheque', 'transfer', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ALLOCATION_METHODS = [
  'by_ownership',
  'equal_units',
  'by_area',
  'single_unit',
] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export const RECURRING_FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'urgent'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_STATUSES = [
  'open',
  'scheduled',
  'in_progress',
  'done',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** `occupied` is derived from an active contract and is never stored; the rest are set by staff. */
export const UNIT_STATUSES = [
  'occupied',
  'vacant_ready',
  'under_maintenance',
  'reserved',
  'not_available',
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export type ManualUnitStatus = Exclude<UnitStatus, 'occupied'>;
export const MANUAL_UNIT_STATUSES: readonly ManualUnitStatus[] = UNIT_STATUSES.filter(
  (s): s is ManualUnitStatus => s !== 'occupied',
);

// VAT -------------------------------------------------------------------------------------------

/** UAE VAT, 5 %, in basis points. */
export const UAE_VAT_BP = 500;

/** VAT on an amount at `rateBp` basis points, rounded to the nearest fils (half up). */
export function vatFor(amountFils: number, rateBp: number = UAE_VAT_BP): number {
  assertFils(amountFils, 'amount');
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000)
    throw new RangeError(`rateBp must be 0..10000, got ${String(rateBp)}`);
  return Number((BigInt(amountFils) * BigInt(rateBp) + 5000n) / 10_000n);
}

export function expenseTotal(amountFils: number, vatFils: number): number {
  return assertFils(amountFils, 'amount') + assertFils(vatFils, 'vat');
}

// Largest-remainder split -----------------------------------------------------------------------

export interface Weighted<K extends string = string> {
  key: K;
  /** Non-negative integer weight; a zero weight receives nothing. */
  weight: number;
}

export interface Part<K extends string = string> {
  key: K;
  amountFils: number;
}

/**
 * Split `totalFils` across `items` in proportion to their weights. Each part is floored, then the
 * leftover fils go one each to the parts with the largest fractional remainder, ties broken by key
 * (ascending, code-point order), so the result is deterministic and sums exactly to the total.
 */
export function splitByWeights<K extends string>(
  totalFils: number,
  items: readonly Weighted<K>[],
): Part<K>[] {
  assertFils(totalFils, 'total');
  if (totalFils < 0) throw new RangeError('totalFils must not be negative');
  if (items.length === 0) throw new RangeError('Nothing to split across');
  const seen = new Set<string>();
  let sum = 0;
  for (const it of items) {
    if (!Number.isInteger(it.weight) || it.weight < 0)
      throw new RangeError(`weight must be a non-negative integer, got ${String(it.weight)}`);
    if (seen.has(it.key)) throw new RangeError(`duplicate key ${it.key}`);
    seen.add(it.key);
    sum += it.weight;
  }
  if (sum === 0) throw new RangeError('All weights are zero');

  // floor(total * weight / sum) and its remainder. With plain numbers while every product stays
  // exact (below 2^53: any rent or expense against any building's areas or shares), otherwise in
  // BigInt; the BigInt path is several times slower and splits run for every unit of a building.
  const parts: { key: K; amountFils: number; remainder: number | bigint }[] = [];
  if (Number.isSafeInteger(sum) && totalFils * sum <= Number.MAX_SAFE_INTEGER) {
    for (const it of items) {
      const scaled = totalFils * it.weight;
      // Both operands are integers below 2^53, so the rounded quotient floors to the exact one
      // (being one off needs a dividend of 2^53 or more) and the remainder is exact too.
      const q = Math.floor(scaled / sum);
      parts.push({ key: it.key, amountFils: q, remainder: scaled - q * sum });
    }
  } else {
    const total = BigInt(totalFils);
    const bigSum = items.reduce((acc, it) => acc + BigInt(it.weight), 0n);
    for (const it of items) {
      const scaled = total * BigInt(it.weight);
      parts.push({ key: it.key, amountFils: Number(scaled / bigSum), remainder: scaled % bigSum });
    }
  }

  // The floors leave fewer fils over than there are parts with a remainder (the remainders add
  // up to leftover * sum, each below sum): one fil each to the largest remainders, ties by key.
  let leftover = totalFils - parts.reduce((acc, p) => acc + p.amountFils, 0);
  if (leftover > 0) {
    const order = parts
      .filter((p) => p.remainder > 0)
      .sort((a, b) =>
        a.remainder === b.remainder
          ? a.key < b.key
            ? -1
            : a.key > b.key
              ? 1
              : 0
          : a.remainder > b.remainder
            ? -1
            : 1,
      );
    for (const target of order) {
      if (leftover === 0) break;
      target.amountFils += 1;
      leftover -= 1;
    }
  }
  return parts.map(({ key, amountFils }) => ({ key, amountFils }));
}

// Allocation of an expense to owners --------------------------------------------------------------

export interface AllocationOwner {
  ownerId: string;
  shareBp: number;
}

export interface AllocationUnit {
  unitId: string;
  sizeSqft: number | null;
  /** The owners holding the unit on the expense's invoice date. */
  owners: readonly AllocationOwner[];
}

export interface Allocation {
  unitId: string;
  ownerId: string;
  amountFils: number;
}

/** `by_area` when every unit has a size, otherwise `equal_units`. */
export function defaultAllocationMethod(
  units: readonly { sizeSqft: number | null }[],
): 'by_area' | 'equal_units' {
  return units.length > 0 && units.every((u) => u.sizeSqft !== null && u.sizeSqft > 0)
    ? 'by_area'
    : 'equal_units';
}

/** The checks every allocation makes before splitting: the same errors for both entry points. */
function assertAllocationInput(totalFils: number, units: readonly AllocationUnit[]): void {
  assertFils(totalFils, 'total');
  if (totalFils < 0) throw new RangeError('totalFils must not be negative');
  if (units.length === 0) throw new RangeError('An expense needs at least one unit');
  const ids = new Set<string>();
  for (const u of units) {
    if (ids.has(u.unitId)) throw new RangeError(`duplicate unit ${u.unitId}`);
    ids.add(u.unitId);
    if (u.owners.length === 0) throw new RangeError(`Unit ${u.unitId} has no owners on that date`);
    const owners = new Set<string>();
    for (const o of u.owners) {
      if (owners.has(o.ownerId)) throw new RangeError(`duplicate owner ${o.ownerId}`);
      owners.add(o.ownerId);
      if (!Number.isInteger(o.shareBp) || o.shareBp < 1)
        throw new RangeError(`shareBp must be a positive integer, got ${String(o.shareBp)}`);
    }
  }
}

/**
 * One owner's part of an expense (optionally on one unit only): exactly the sum of that owner's
 * rows from `allocateExpense`, but only the owner's units are split across their owners, so a
 * building-wide rule costs one split of the building plus one per unit the owner holds. Used by
 * projections, which need the owner's figure for many rules on every request.
 */
export function ownerShareOfExpense(
  totalFils: number,
  method: AllocationMethod,
  units: readonly AllocationUnit[],
  ownerId: string,
  unitId?: string | null,
): number {
  if (method === 'by_ownership') {
    return allocateExpense(totalFils, method, units)
      .filter((a) => a.ownerId === ownerId && (!unitId || a.unitId === unitId))
      .reduce((acc, a) => acc + a.amountFils, 0);
  }
  assertAllocationInput(totalFils, units);
  const ownerPart = (unit: AllocationUnit, part: number): number => {
    if (unitId && unit.unitId !== unitId) return 0;
    if (!unit.owners.some((o) => o.ownerId === ownerId)) return 0;
    const split = splitByWeights(
      part,
      unit.owners.map((o) => ({ key: o.ownerId, weight: o.shareBp })),
    );
    return split.find((p) => p.key === ownerId)?.amountFils ?? 0;
  };
  if (method === 'single_unit') {
    const unit = units[0];
    if (units.length !== 1 || !unit)
      throw new RangeError('single_unit allocation needs exactly one unit');
    return ownerPart(unit, totalFils);
  }
  const weights = units.map((u) => {
    if (method === 'by_area' && !(u.sizeSqft !== null && u.sizeSqft > 0))
      throw new RangeError(`by_area needs a size on every unit (unit ${u.unitId})`);
    return {
      key: u.unitId,
      weight: method === 'by_area' && u.sizeSqft !== null ? Math.round(u.sizeSqft) : 1,
    };
  });
  const parts = splitByWeights(totalFils, weights);
  let mine = 0;
  for (const [i, p] of parts.entries()) {
    const unit = units[i];
    if (unit) mine += ownerPart(unit, p.amountFils);
  }
  return mine;
}

/**
 * Split an expense first across units (by the method), then each unit's part across its owners by
 * `shareBp`. `by_ownership` gives every owner of the building an equal part, spread over that
 * owner's units equally. Every unit must have at least one owner on the invoice date.
 */
export function allocateExpense(
  totalFils: number,
  method: AllocationMethod,
  units: readonly AllocationUnit[],
): Allocation[] {
  assertAllocationInput(totalFils, units);

  const out = new Map<string, Allocation>();
  const add = (unitId: string, ownerId: string, amountFils: number) => {
    const key = `${unitId}|${ownerId}`;
    const existing = out.get(key);
    if (existing) existing.amountFils += amountFils;
    else out.set(key, { unitId, ownerId, amountFils });
  };
  const splitUnit = (unit: AllocationUnit, part: number) => {
    for (const p of splitByWeights(
      part,
      unit.owners.map((o) => ({ key: o.ownerId, weight: o.shareBp })),
    ))
      add(unit.unitId, p.key, p.amountFils);
  };

  switch (method) {
    case 'single_unit': {
      const unit = units[0];
      if (units.length !== 1 || !unit)
        throw new RangeError('single_unit allocation needs exactly one unit');
      splitUnit(unit, totalFils);
      break;
    }
    case 'equal_units':
    case 'by_area': {
      const weights = units.map((u) => {
        if (method === 'by_area' && !(u.sizeSqft !== null && u.sizeSqft > 0))
          throw new RangeError(`by_area needs a size on every unit (unit ${u.unitId})`);
        return {
          key: u.unitId,
          weight: method === 'by_area' && u.sizeSqft !== null ? Math.round(u.sizeSqft) : 1,
        };
      });
      // splitByWeights returns the parts in the order of its items, so part i is unit i.
      for (const [i, p] of splitByWeights(totalFils, weights).entries()) {
        const unit = units[i];
        if (unit) splitUnit(unit, p.amountFils);
      }
      break;
    }
    case 'by_ownership': {
      // Each owner's units in one pass (in the order of `units`), not a scan of every unit per
      // owner: a 2,000-unit building took 130 ms that way, past the Worker's CPU budget.
      const unitsOf = new Map<string, string[]>();
      for (const u of units)
        for (const o of u.owners) {
          const list = unitsOf.get(o.ownerId);
          if (list) list.push(u.unitId);
          else unitsOf.set(o.ownerId, [u.unitId]);
        }
      const ownerIds = [...unitsOf.keys()].sort();
      const perOwner = splitByWeights(
        totalFils,
        ownerIds.map((id) => ({ key: id, weight: 1 })),
      );
      for (const p of perOwner) {
        const theirUnits = unitsOf.get(p.key) ?? [];
        for (const q of splitByWeights(
          p.amountFils,
          theirUnits.map((unitId) => ({ key: unitId, weight: 1 })),
        ))
          add(q.key, p.key, q.amountFils);
      }
      break;
    }
  }
  return [...out.values()].sort(
    (a, b) => byText.compare(a.unitId, b.unitId) || byText.compare(a.ownerId, b.ownerId),
  );
}

/** Same order as `localeCompare` with the default locale, without building a collator per call. */
const byText = new Intl.Collator();

export function sumAllocations(allocations: readonly { amountFils: number }[]): number {
  return allocations.reduce((acc, a) => acc + assertFils(a.amountFils), 0);
}

// Ownership on a date ----------------------------------------------------------------------------

export interface OwnershipRow {
  unitId: string;
  ownerId: string;
  shareBp: number;
  fromDate: PlainDate;
  /** Exclusive: the day the next owners took over; null while current. */
  toDate: PlainDate | null;
}

/** The owners of a unit valid on `date` (`from <= date < to`). */
export function ownersOnDate(
  rows: readonly OwnershipRow[],
  unitId: string,
  date: PlainDate,
): AllocationOwner[] {
  return rows
    .filter(
      (r) => r.unitId === unitId && r.fromDate <= date && (r.toDate === null || r.toDate > date),
    )
    .map((r) => ({ ownerId: r.ownerId, shareBp: r.shareBp }));
}

/**
 * The owners of every unit on `date` in one pass over the rows: for a whole building, where
 * calling `ownersOnDate` once per unit reads all the rows once per unit. Units nobody held on
 * that date are absent from the map.
 */
export function ownersByUnitOnDate(
  rows: readonly OwnershipRow[],
  date: PlainDate,
): Map<string, AllocationOwner[]> {
  const out = new Map<string, AllocationOwner[]>();
  for (const r of rows) {
    if (!(r.fromDate <= date && (r.toDate === null || r.toDate > date))) continue;
    const owner = { ownerId: r.ownerId, shareBp: r.shareBp };
    const list = out.get(r.unitId);
    if (list) list.push(owner);
    else out.set(r.unitId, [owner]);
  }
  return out;
}

/** One owner's share of a unit on `date`, 0 when they did not hold it then. */
export function shareOnDate(
  rows: readonly OwnershipRow[],
  unitId: string,
  ownerId: string,
  date: PlainDate,
): number {
  return ownersOnDate(rows, unitId, date).find((o) => o.ownerId === ownerId)?.shareBp ?? 0;
}

// Recurring rules ---------------------------------------------------------------------------------

export interface RecurringRuleLike {
  frequency: RecurringFrequency;
  /** 1..31, clamped to the month's length. */
  dayOfMonth: number;
  startDate: PlainDate;
  endDate: PlainDate | null;
}

const MONTHS_PER: Record<RecurringFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

function dueOn(year: number, month: number, dayOfMonth: number): PlainDate {
  return fromParts({ year, month, day: Math.min(dayOfMonth, daysInMonth(year, month)) });
}

/**
 * Due dates of a rule inside a period. The first due date is on or after the start date, in the
 * start date's month when the day has not passed yet, otherwise the next month; then every 1, 3
 * or 12 months, the day clamped to the month end (31 -> 28/29 Feb). The end date, when set, is
 * inclusive.
 */
export function recurringDueDates(rule: RecurringRuleLike, period: Period): PlainDate[] {
  if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)
    throw new RangeError(`dayOfMonth must be 1..31, got ${String(rule.dayOfMonth)}`);
  const step = MONTHS_PER[rule.frequency];
  const start = toParts(rule.startDate);
  let anchor = fromParts({ year: start.year, month: start.month, day: 1 });
  if (dueOn(start.year, start.month, rule.dayOfMonth) < rule.startDate)
    anchor = addMonthsClamped(anchor, 1);
  const out: PlainDate[] = [];
  const last = rule.endDate !== null && rule.endDate < period.to ? rule.endDate : period.to;
  // Each due date falls in its own month, so the steps whose month is before the period's first
  // month are skipped without being computed: a rule that started years ago costs the months of
  // the period, not every month since its start.
  // Months are counted as integers (year * 12 + month - 1), so a step costs no date strings.
  const a = toParts(anchor);
  const f = toParts(period.from);
  const anchorIndex = a.year * 12 + a.month - 1;
  const monthsToPeriod = f.year * 12 + f.month - 1 - anchorIndex;
  const firstStep = monthsToPeriod > 0 ? Math.floor(monthsToPeriod / step) : 0;
  for (let i = firstStep; ; i += 1) {
    const index = anchorIndex + i * step;
    const due = dueOn(Math.floor(index / 12), (index % 12) + 1, rule.dayOfMonth);
    if (due > last) break;
    if (due >= period.from) out.push(due);
    if (out.length > 1200) throw new RangeError('recurring range too long');
  }
  return out;
}

/** The period a fixed expense due on `dueDate` covers: its month, quarter or year. */
export function coveredPeriod(dueDate: PlainDate, frequency: RecurringFrequency): Period {
  const { year, month } = toParts(dueDate);
  const from = fromParts({ year, month, day: 1 });
  return { from, to: lastDayOfMonth(addMonthsClamped(from, MONTHS_PER[frequency] - 1)) };
}

/** The first due date strictly after `after`, or null when the rule has ended. */
export function nextDueDate(rule: RecurringRuleLike, after: PlainDate): PlainDate | null {
  const horizon = addMonthsClamped(after, 13);
  const dates = recurringDueDates(rule, { from: after, to: horizon });
  return dates.find((d) => d > after) ?? null;
}

export interface ProjectableRule extends RecurringRuleLike {
  id: string;
  active: boolean;
  amountFils: number;
  vatFils: number;
}

export interface FixedProjection {
  ruleId: string;
  dueDate: PlainDate;
  totalFils: number;
}

/**
 * Expected fixed expenses: every due date of an active rule inside the period that is still in
 * the future (strictly after `today`); what is due today or earlier is an actual posted expense
 * or a draft waiting for staff, never a projection. Variable costs are never projected.
 */
export function projectFixedExpenses(
  rules: readonly ProjectableRule[],
  period: Period,
  today: PlainDate,
): FixedProjection[] {
  const out: FixedProjection[] = [];
  for (const r of rules) {
    if (!r.active) continue;
    const total = expenseTotal(r.amountFils, r.vatFils);
    for (const dueDate of recurringDueDates(r, period)) {
      if (dueDate > today) out.push({ ruleId: r.id, dueDate, totalFils: total });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.ruleId.localeCompare(b.ruleId));
}

// Data-quality guards -----------------------------------------------------------------------------

/** AED 5,000 unless the admin changes it in settings. */
export const DEFAULT_LARGE_EXPENSE_ALERT_FILS = 500_000;

export function isLargeExpense(totalFils: number, thresholdFils: number): boolean {
  return assertFils(totalFils) >= assertFils(thresholdFils, 'threshold') && thresholdFils > 0;
}

/** More than three times the category's 12-month average (no average: never an outlier). */
export const OUTLIER_FACTOR = 3;

export function isExpenseOutlier(totalFils: number, averageFils: number | null): boolean {
  if (averageFils === null || averageFils <= 0) return false;
  return assertFils(totalFils) > OUTLIER_FACTOR * averageFils;
}
