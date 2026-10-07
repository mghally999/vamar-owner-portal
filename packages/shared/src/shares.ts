/**
 * Owner shares (business rule 5.3). Shares are basis points: 10000 bp = 100 %.
 */
import { assertFils } from './money.js';

export const TOTAL_SHARE_BP = 10_000;

export interface OwnerShare<Id = string> {
  ownerId: Id;
  shareBp: number;
}

export function assertShareBp(bp: number): number {
  if (!Number.isInteger(bp) || bp < 1 || bp > TOTAL_SHARE_BP) {
    throw new RangeError(`shareBp must be an integer from 1 to 10000, got ${String(bp)}`);
  }
  return bp;
}

export interface ShareValidation {
  totalBp: number;
  valid: boolean;
  /** Positive when the shares exceed 100 %, negative when short. */
  differenceBp: number;
  duplicateOwnerIds: string[];
}

/** Current owners of a unit must sum to exactly 10000 bp with no owner listed twice. */
export function validateShares<Id extends string>(
  shares: readonly OwnerShare<Id>[],
): ShareValidation {
  let total = 0;
  const seen = new Map<string, number>();
  for (const s of shares) {
    total += assertShareBp(s.shareBp);
    seen.set(s.ownerId, (seen.get(s.ownerId) ?? 0) + 1);
  }
  const duplicateOwnerIds = [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  return {
    totalBp: total,
    differenceBp: total - TOTAL_SHARE_BP,
    duplicateOwnerIds,
    valid: shares.length > 0 && total === TOTAL_SHARE_BP && duplicateOwnerIds.length === 0,
  };
}

/** One owner's floor share of an amount: `amount * bp / 10000` in integer math. */
export function ownerShareAmount(amountFils: number, shareBp: number): number {
  assertFils(amountFils);
  assertShareBp(shareBp);
  return Number((BigInt(amountFils) * BigInt(shareBp)) / BigInt(TOTAL_SHARE_BP));
}

export interface SharePart<Id = string> {
  ownerId: Id;
  shareBp: number;
  amountFils: number;
}

/**
 * Split one cheque across several owners so the parts sum exactly to the cheque.
 * Each share is floored; the leftover fils go one each to the owners with the largest
 * shares, tie-broken by owner id (ascending, code-point order) so the result is deterministic.
 */
export function splitByShares<Id extends string>(
  amountFils: number,
  shares: readonly OwnerShare<Id>[],
): SharePart<Id>[] {
  assertFils(amountFils);
  if (amountFils < 0) throw new RangeError('amountFils must not be negative');
  const validation = validateShares(shares);
  if (!validation.valid) {
    throw new RangeError(
      `Shares must sum to ${TOTAL_SHARE_BP} bp with unique owners (got ${validation.totalBp} bp)`,
    );
  }

  const parts: SharePart<Id>[] = shares.map((s) => ({
    ownerId: s.ownerId,
    shareBp: s.shareBp,
    amountFils: ownerShareAmount(amountFils, s.shareBp),
  }));

  let leftover = amountFils - parts.reduce((acc, p) => acc + p.amountFils, 0);
  if (leftover > 0) {
    const order = [...parts].sort(
      (a, b) =>
        b.shareBp - a.shareBp || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0),
    );
    for (let i = 0; leftover > 0; i = (i + 1) % order.length) {
      const target = order[i];
      if (target) target.amountFils += 1;
      leftover -= 1;
    }
  }
  return parts;
}
