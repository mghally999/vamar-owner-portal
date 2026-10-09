/**
 * Cheque schedule from a contract (business rule 5.1).
 * The system creates the rows and due dates; staff type every amount, cheque number and bank.
 */
import { addDays, addMonthsClamped, diffDays, type PlainDate } from './dates.js';

export const MIN_CHEQUE_COUNT = 1;
export const MAX_CHEQUE_COUNT = 12;

export interface ScheduleInput {
  startDate: PlainDate;
  endDate: PlainDate;
  chequeCount: number;
}

export interface ScheduledCheque {
  /** 1-based position in the contract. */
  seq: number;
  dueDate: PlainDate;
}

export function assertChequeCount(n: number): number {
  if (!Number.isInteger(n) || n < MIN_CHEQUE_COUNT || n > MAX_CHEQUE_COUNT) {
    throw new RangeError(`chequeCount must be an integer from 1 to 12, got ${String(n)}`);
  }
  return n;
}

/**
 * - When 12 is divisible by n: due dates are `start + k * (12 / n)` months, each computed
 *   from the original anchor (never chained) and clamped to the end of the month.
 *   31 Jan -> 28/29 Feb -> 31 Mar -> 30 Apr ...
 * - Otherwise (5, 7, 8, 9, 10, 11): spread evenly by days across the inclusive contract
 *   period, rounded to whole days. The first cheque is always on the start date.
 */
export function generateChequeSchedule(input: ScheduleInput): ScheduledCheque[] {
  const n = assertChequeCount(input.chequeCount);
  if (input.endDate < input.startDate) {
    throw new RangeError('endDate must be on or after startDate');
  }

  const out: ScheduledCheque[] = [];
  if (12 % n === 0) {
    const stepMonths = 12 / n;
    for (let k = 0; k < n; k++) {
      out.push({ seq: k + 1, dueDate: addMonthsClamped(input.startDate, k * stepMonths) });
    }
  } else {
    const periodDays = diffDays(input.startDate, input.endDate) + 1;
    for (let k = 0; k < n; k++) {
      const offset = Math.round((k * periodDays) / n);
      out.push({ seq: k + 1, dueDate: addDays(input.startDate, offset) });
    }
  }
  return out;
}

export interface GridRow {
  seq: number;
  dueDate: PlainDate;
  amountFils: number | null;
  chequeNo: string | null;
  bankName: string | null;
}

export interface GridValidation {
  totalFils: number;
  annualRentFils: number;
  differenceFils: number;
  /** All amounts, cheque numbers and banks are filled. */
  complete: boolean;
  /** Total equals annual rent. If false and complete, activation needs a confirmed reason. */
  matchesRent: boolean;
  missingSeqs: number[];
  duplicateChequeNos: string[];
}

/**
 * Live validation for the editable cheque grid. Saving as `draft` is always allowed;
 * activating requires `complete`, and when `matchesRent` is false the staff member must
 * confirm and type a reason that is written to the audit log.
 */
export function validateChequeGrid(rows: GridRow[], annualRentFils: number): GridValidation {
  let total = 0;
  const missing: number[] = [];
  const seenNos = new Map<string, number>();
  for (const r of rows) {
    const filled =
      r.amountFils !== null &&
      r.amountFils > 0 &&
      (r.chequeNo?.trim().length ?? 0) > 0 &&
      (r.bankName?.trim().length ?? 0) > 0;
    if (!filled) missing.push(r.seq);
    if (r.amountFils !== null) total += r.amountFils;
    const no = r.chequeNo?.trim();
    if (no) seenNos.set(no, (seenNos.get(no) ?? 0) + 1);
  }
  const duplicates = [...seenNos.entries()].filter(([, c]) => c > 1).map(([no]) => no);
  return {
    totalFils: total,
    annualRentFils,
    differenceFils: total - annualRentFils,
    complete: missing.length === 0 && duplicates.length === 0,
    matchesRent: total === annualRentFils,
    missingSeqs: missing,
    duplicateChequeNos: duplicates,
  };
}

/**
 * Equal split of the annual rent for the optional "split equally" button in the cheque grid.
 * Nothing is pre-filled: the grid starts empty and this runs only when staff press the button.
 * Every cheque is a whole number of dirhams (a multiple of 100 fils); the first cheque takes the
 * remainder so the total is exact. Staff can overwrite any amount afterwards.
 */
export function suggestEqualAmounts(annualRentFils: number, chequeCount: number): number[] {
  const n = assertChequeCount(chequeCount);
  if (!Number.isInteger(annualRentFils) || annualRentFils < 0) {
    throw new RangeError('annualRentFils must be a non-negative integer');
  }
  const FILS_PER_DIRHAM = 100;
  const baseDirhams = Math.floor(Math.floor(annualRentFils / FILS_PER_DIRHAM) / n);
  const base = baseDirhams * FILS_PER_DIRHAM;
  const remainder = annualRentFils - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));
}
