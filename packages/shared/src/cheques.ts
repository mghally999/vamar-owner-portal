/**
 * Cheque state machine (business rule 5.2).
 *
 *   upcoming  -> deposited | cancelled
 *   deposited -> cleared | bounced
 *   bounced   -> deposited (re-deposit) | replaced
 *   cleared, replaced, cancelled: terminal
 */

export const CHEQUE_STATUSES = [
  'upcoming',
  'deposited',
  'cleared',
  'bounced',
  'replaced',
  'cancelled',
] as const;

export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

export const CHEQUE_TRANSITIONS: Readonly<Record<ChequeStatus, readonly ChequeStatus[]>> = {
  upcoming: ['deposited', 'cancelled'],
  deposited: ['cleared', 'bounced'],
  bounced: ['deposited', 'replaced'],
  cleared: [],
  replaced: [],
  cancelled: [],
};

export const TERMINAL_CHEQUE_STATUSES: readonly ChequeStatus[] = [
  'cleared',
  'replaced',
  'cancelled',
];

/** Statuses that still count as money expected (not yet in the bank, not written off). */
export const PENDING_CHEQUE_STATUSES: readonly ChequeStatus[] = ['upcoming', 'deposited'];

export function isChequeStatus(value: unknown): value is ChequeStatus {
  return typeof value === 'string' && (CHEQUE_STATUSES as readonly string[]).includes(value);
}

export function isTerminalChequeStatus(status: ChequeStatus): boolean {
  return TERMINAL_CHEQUE_STATUSES.includes(status);
}

export function canTransitionCheque(from: ChequeStatus, to: ChequeStatus): boolean {
  return CHEQUE_TRANSITIONS[from].includes(to);
}

export class InvalidChequeTransitionError extends Error {
  override readonly name = 'InvalidChequeTransitionError';
  constructor(
    readonly from: ChequeStatus,
    readonly to: ChequeStatus,
  ) {
    super(`Cannot move a cheque from ${from} to ${to}`);
  }
}

export interface ChequeTransitionOptions {
  /** Admins may correct a terminal status; a reason is mandatory and the change is audited. */
  adminOverride?: { reason: string } | undefined;
}

export interface ChequeTransitionEffects {
  from: ChequeStatus;
  to: ChequeStatus;
  /** A replacement cheque must be created in the same transaction. */
  requiresReplacementCheque: boolean;
  /** Owners of the unit must be notified immediately. */
  notifyOwners: boolean;
  /** Which timestamp column to stamp alongside status_changed_at. */
  stamp: 'deposited_at' | 'cleared_at' | 'bounced_at' | null;
  /** Set when the transition only happened because of an admin override. */
  overrideReason: string | null;
}

/**
 * Validate a transition and describe its side effects. Throws on an illegal move.
 * Pure: the API applies the effects inside one database transaction.
 */
export function transitionCheque(
  from: ChequeStatus,
  to: ChequeStatus,
  options: ChequeTransitionOptions = {},
): ChequeTransitionEffects {
  if (from === to) throw new InvalidChequeTransitionError(from, to);

  let overrideReason: string | null = null;
  if (!canTransitionCheque(from, to)) {
    const override = options.adminOverride;
    const allowed = isTerminalChequeStatus(from) && override !== undefined;
    if (!allowed || override.reason.trim().length === 0) {
      throw new InvalidChequeTransitionError(from, to);
    }
    overrideReason = override.reason.trim();
  }

  return {
    from,
    to,
    requiresReplacementCheque: to === 'replaced',
    notifyOwners: to === 'bounced',
    stamp:
      to === 'deposited'
        ? 'deposited_at'
        : to === 'cleared'
          ? 'cleared_at'
          : to === 'bounced'
            ? 'bounced_at'
            : null,
    overrideReason,
  };
}

export interface BulkTransitionItem<Id = string> {
  id: Id;
  from: ChequeStatus;
}

export interface BulkTransitionResult<Id = string> {
  ok: { id: Id; effects: ChequeTransitionEffects }[];
  failed: { id: Id; from: ChequeStatus; reason: string }[];
}

/** Validate many cheques against one target status; each is judged on its own. */
export function planBulkTransition<Id = string>(
  items: readonly BulkTransitionItem<Id>[],
  to: ChequeStatus,
): BulkTransitionResult<Id> {
  const result: BulkTransitionResult<Id> = { ok: [], failed: [] };
  for (const item of items) {
    try {
      result.ok.push({ id: item.id, effects: transitionCheque(item.from, to) });
    } catch (e) {
      result.failed.push({
        id: item.id,
        from: item.from,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
