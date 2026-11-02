/**
 * Rent in a period (v2 business rules), for the owner summary, the staff reports and the PDF.
 *
 *   expected    = cheques due in the period that are upcoming, deposited, cleared or bounced
 *                 (a replaced cheque counts once, through its replacement; cancelled never)
 *   collected   = the cleared ones
 *   at risk     = the bounced ones, shown on their own
 *   outstanding = expected - collected - at risk  (= upcoming + deposited)
 *
 * so expected = collected + outstanding + at risk always holds. Amounts are the owner's share.
 */
import { EXPECTED_CHEQUE_STATUSES, type ChequeStatus } from './cheques.js';
import { assertFils } from './money.js';

export interface RentChequeLike {
  status: ChequeStatus;
  amountFils: number;
}

export interface RentSummary {
  expectedFils: number;
  collectedFils: number;
  outstandingFils: number;
  atRiskFils: number;
  chequeCount: number;
  bouncedCount: number;
}

export function summariseRent(items: readonly RentChequeLike[]): RentSummary {
  let expected = 0;
  let collected = 0;
  let atRisk = 0;
  let count = 0;
  let bounced = 0;
  for (const c of items) {
    const amount = assertFils(c.amountFils);
    if (!EXPECTED_CHEQUE_STATUSES.includes(c.status)) continue;
    expected += amount;
    count += 1;
    if (c.status === 'cleared') collected += amount;
    if (c.status === 'bounced') {
      atRisk += amount;
      bounced += 1;
    }
  }
  return {
    expectedFils: expected,
    collectedFils: collected,
    outstandingFils: expected - collected - atRisk,
    atRiskFils: atRisk,
    chequeCount: count,
    bouncedCount: bounced,
  };
}

export interface ExpenseTotals {
  fixedFils: number;
  variableFils: number;
}

/** Net = collected rent minus posted expenses (fixed and variable), before the management fee. */
export function netFils(collectedFils: number, expenses: ExpenseTotals): number {
  return (
    assertFils(collectedFils) - assertFils(expenses.fixedFils) - assertFils(expenses.variableFils)
  );
}

/**
 * Projected net = expected rent minus fixed expenses (posted so far plus projections from the
 * recurring rules). Variable expenses are never projected, so they are left out on purpose.
 */
export function projectedNetFils(expectedFils: number, fixedFils: number): number {
  return assertFils(expectedFils) - assertFils(fixedFils);
}

/** Percent change against the comparison period; null when the comparison is zero. */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
