/**
 * Who holds each unit for an allocation on a date, in one pass over the ownership rows (the old
 * per-unit `ownersOnDate` was O(units x rows): a 1,000-unit building over 3,000 rows took 25 ms).
 * A unit nobody held on that date (an invoice dated before its first owner) falls back to its
 * current owners. Used by expense allocation and the repair approval shares.
 */
import { ownersByUnitOnDate, type AllocationOwner, type PlainDate } from '@vamar/shared';

export interface OwnershipRowLike {
  unitId: string;
  ownerId: string;
  shareBp: number;
  fromDate: string;
  toDate: string | null;
}

export function holdersByUnit(
  rows: readonly OwnershipRowLike[],
  date: PlainDate,
): (unitId: string) => AllocationOwner[] {
  const typed = rows.map((r) => ({
    ...r,
    fromDate: r.fromDate as PlainDate,
    toDate: r.toDate as PlainDate | null,
  }));
  const onDate = ownersByUnitOnDate(typed, date);
  const current = new Map<string, AllocationOwner[]>();
  for (const r of typed) {
    if (r.toDate !== null) continue;
    const owner = { ownerId: r.ownerId, shareBp: r.shareBp };
    const list = current.get(r.unitId);
    if (list) list.push(owner);
    else current.set(r.unitId, [owner]);
  }
  return (unitId) => onDate.get(unitId) ?? current.get(unitId) ?? [];
}
