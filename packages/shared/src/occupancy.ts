/**
 * Occupancy (business rule 5.4).
 */
import type { PlainDate } from './dates.js';

export const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated', 'renewed'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface ContractWindow {
  unitId: string;
  status: ContractStatus;
  startDate: PlainDate;
  endDate: PlainDate;
}

/** A unit is occupied on `d` if an `active` contract has start <= d <= end. */
export function isUnitOccupiedOn(
  unitId: string,
  contracts: readonly ContractWindow[],
  d: PlainDate,
): boolean {
  return contracts.some(
    (c) => c.unitId === unitId && c.status === 'active' && c.startDate <= d && d <= c.endDate,
  );
}

/** Whole percent 0-100; 0 when there are no units. */
export function occupancyPct(occupied: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(occupied, total) / total) * 100);
}

export interface OccupancyStats {
  occupied: number;
  total: number;
  /** Whole percent 0-100; 0 when the owner has no units. */
  pct: number;
  vacantUnitIds: string[];
}

/** Occupancy across the units an owner has any share in. */
export function occupancyStats(
  unitIds: readonly string[],
  contracts: readonly ContractWindow[],
  d: PlainDate,
): OccupancyStats {
  const unique = [...new Set(unitIds)];
  const vacant: string[] = [];
  let occupied = 0;
  for (const id of unique) {
    if (isUnitOccupiedOn(id, contracts, d)) occupied += 1;
    else vacant.push(id);
  }
  const total = unique.length;
  return { occupied, total, pct: occupancyPct(occupied, total), vacantUnitIds: vacant };
}

export type VacantSince = { kind: 'since'; date: PlainDate } | { kind: 'never_rented' };

/**
 * For a vacant unit: the end date of the last contract that has actually ended on or before `d`
 * (status active, expired, terminated or renewed; drafts never count). `never_rented` when
 * there is none.
 */
export function vacantSince(
  unitId: string,
  contracts: readonly ContractWindow[],
  d: PlainDate,
): VacantSince {
  let latest: PlainDate | null = null;
  for (const c of contracts) {
    if (c.unitId !== unitId || c.status === 'draft') continue;
    if (c.endDate < d && (latest === null || c.endDate > latest)) latest = c.endDate;
  }
  return latest ? { kind: 'since', date: latest } : { kind: 'never_rented' };
}
