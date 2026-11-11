/**
 * Owner approval of large repairs (v3). A work order whose estimate, or a variable expense draft
 * whose total, is at or above the admin's threshold asks every owner with a share in it to approve
 * before the work starts or the money is posted. These are the pure rules both apps and the API use.
 */
import { addDays, type PlainDate } from './dates.js';
import type { WorkOrderStatus } from './expenses.js';

/** AED 5,000. */
export const DEFAULT_REPAIR_APPROVAL_THRESHOLD_FILS = 500_000;
/** An unanswered request counts as approved this many days after it was sent; 0 turns that off. */
export const DEFAULT_REPAIR_APPROVAL_SILENCE_DAYS = 3;
/** The admin may wait at most this long for an answer before silence counts. */
export const MAX_REPAIR_APPROVAL_SILENCE_DAYS = 60;

export const REPAIR_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'approved_by_silence',
] as const;
export type RepairApprovalStatus = (typeof REPAIR_APPROVAL_STATUSES)[number];

export const REPAIR_APPROVAL_DECISIONS = ['approve', 'reject'] as const;
export type RepairApprovalDecision = (typeof REPAIR_APPROVAL_DECISIONS)[number];

/**
 * The job may not reach these while an answer is pending or rejected. Done is held back too:
 * otherwise "mark done" would be a way round the approval.
 */
export const APPROVAL_GATED_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  'in_progress',
  'done',
];

/** The statuses in which a work order may still ask its owners (the work has not started). */
export const APPROVAL_ASKABLE_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  'open',
  'scheduled',
];

/** Amounts with no figure (a work order without an estimate) never need approval. */
export function needsOwnerApproval(amountFils: number | null, thresholdFils: number): boolean {
  return amountFils !== null && amountFils > 0 && amountFils >= thresholdFils;
}

export interface ApprovalLike {
  status: RepairApprovalStatus;
  /** Set when an admin let the job go ahead without this answer. */
  overriddenAt: Date | string | null;
}

/** An answer that still holds the job back: pending or rejected, and not overridden by an admin. */
export function isBlockingApproval(a: ApprovalLike): boolean {
  return (a.status === 'pending' || a.status === 'rejected') && a.overriddenAt === null;
}

export function approvalsBlock(rows: readonly ApprovalLike[]): boolean {
  return rows.some(isBlockingApproval);
}

/**
 * One word for a job's approvals, for list chips and filters: `none` when nobody was asked,
 * `rejected` when any blocking answer is a no, `pending` while any blocking answer is awaited,
 * `overridden` when an admin let it through over a blocking answer, otherwise `approved`.
 */
export type ApprovalState = 'none' | 'pending' | 'rejected' | 'approved' | 'overridden';

export function approvalState(rows: readonly ApprovalLike[]): ApprovalState {
  if (rows.length === 0) return 'none';
  const blocking = rows.filter(isBlockingApproval);
  if (blocking.some((a) => a.status === 'rejected')) return 'rejected';
  if (blocking.length > 0) return 'pending';
  if (rows.some((a) => a.overriddenAt !== null && a.status !== 'approved')) return 'overridden';
  return 'approved';
}

/**
 * The day an unanswered request counts as approved, or null when silent approval is off.
 * Asked on the 1st with 3 days: approved by silence on the 4th.
 */
export function silenceDeadline(askedOn: PlainDate, silenceDays: number): PlainDate | null {
  if (!Number.isInteger(silenceDays) || silenceDays <= 0) return null;
  return addDays(askedOn, silenceDays);
}

/** Whether the daily job should mark this pending answer as approved by silence today. */
export function silenceIsDue(askedOn: PlainDate, silenceDays: number, today: PlainDate): boolean {
  const deadline = silenceDeadline(askedOn, silenceDays);
  return deadline !== null && deadline <= today;
}

/** The latest asked-on date that is due on `today`, for the cron's single UPDATE; null when off. */
export function silenceCutoff(silenceDays: number, today: PlainDate): PlainDate | null {
  if (!Number.isInteger(silenceDays) || silenceDays <= 0) return null;
  return addDays(today, -silenceDays);
}
