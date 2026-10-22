/**
 * Alert selection for the daily cron (business rule 5.7) and the dedupe key that makes a re-run
 * idempotent. Message texts live in i18n/notifications.ts.
 */
import { addDays, type PlainDate } from './dates.js';
import type { ChequeStatus } from './cheques.js';
import type { ContractStatus } from './occupancy.js';

export const CHEQUE_REMINDER_DAYS = 3;
export const CONTRACT_ENDING_DAYS = [60, 30] as const;
/** Dashboard overview windows: cheques due within a week, contracts ending within two months. */
export const OVERVIEW_DUE_SOON_DAYS = 7;
export const OVERVIEW_CONTRACT_ENDING_DAYS = 60;

export const NOTIFICATION_TYPES = [
  'cheque_due_soon',
  'cheque_bounced',
  'contract_ending_60',
  'contract_ending_30',
  'new_device_login',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface ChequeForAlert {
  id: string;
  dueDate: PlainDate;
  status: ChequeStatus;
}

export interface ContractForAlert {
  id: string;
  endDate: PlainDate;
  status: ContractStatus;
}

/** Upcoming cheques due in exactly `CHEQUE_REMINDER_DAYS` days. */
export function selectChequesDueSoon<T extends ChequeForAlert>(
  cheques: readonly T[],
  today: PlainDate,
): T[] {
  const target = addDays(today, CHEQUE_REMINDER_DAYS);
  return cheques.filter((c) => c.status === 'upcoming' && c.dueDate === target);
}

export interface EndingContract<T> {
  contract: T;
  daysLeft: 60 | 30;
  type: 'contract_ending_60' | 'contract_ending_30';
}

/** Active contracts ending in exactly 60 or 30 days. */
export function selectContractsEnding<T extends ContractForAlert>(
  contracts: readonly T[],
  today: PlainDate,
): EndingContract<T>[] {
  const out: EndingContract<T>[] = [];
  for (const daysLeft of CONTRACT_ENDING_DAYS) {
    const target = addDays(today, daysLeft);
    for (const c of contracts) {
      if (c.status === 'active' && c.endDate === target) {
        out.push({ contract: c, daysLeft, type: `contract_ending_${daysLeft}` });
      }
    }
  }
  return out;
}

/** Active contracts whose end date is before today should be marked `expired`. */
export function selectContractsToExpire<T extends ContractForAlert>(
  contracts: readonly T[],
  today: PlainDate,
): T[] {
  return contracts.filter((c) => c.status === 'active' && c.endDate < today);
}

/**
 * `type:entityId:date`, unique in notification_log. Daily alerts use the business date so a
 * cron re-run on the same day cannot double-send; instant alerts (bounce, new device) use the
 * date too, which also collapses an accidental double trigger within the same day.
 */
export function dedupeKey(type: NotificationType, entityId: string, date: PlainDate): string {
  return `${type}:${entityId}:${date}`;
}

/** Expo accepts at most 100 messages per push request. */
export const EXPO_PUSH_BATCH_SIZE = 100;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
