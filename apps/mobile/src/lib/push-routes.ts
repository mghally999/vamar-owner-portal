/**
 * Where a tapped push notification takes the owner. The API puts `type` and `entityId` in the
 * notification data (apps/api/src/services/notifications.ts), and the monthly summary also the
 * month it summarises (`from`, `to`); everything else is derived here so the same table serves
 * the phone and the tests.
 */
import { isPlainDate } from './shared';

export type PushHref = string | { pathname: string; params: Record<string, string> };

export interface PushData {
  type?: unknown;
  entityId?: unknown;
  /** Monthly summary only: the first and last day of the month it summarises. */
  from?: unknown;
  to?: unknown;
}

export function routeForNotification(data: PushData | null | undefined): PushHref {
  const type = typeof data?.type === 'string' ? data.type : '';
  const id = typeof data?.entityId === 'string' ? data.entityId : '';
  switch (type) {
    case 'cheque_due_soon':
    case 'cheque_bounced':
      return id ? { pathname: '/cheque/[id]', params: { id } } : '/(tabs)/cheques';
    // Contract endings and budget alerts both open the Properties tab.
    case 'contract_ending_60':
    case 'contract_ending_30':
    case 'budget_threshold':
      return '/(tabs)/properties';
    case 'hearing_soon':
      return id ? { pathname: '/dispute/[id]', params: { id } } : '/(tabs)/disputes';
    case 'work_order_done':
      return id ? { pathname: '/work-order/[id]', params: { id } } : '/work-orders';
    case 'large_expense':
      return id ? { pathname: '/expense/[id]', params: { id } } : '/(tabs)/expenses';
    case 'monthly_summary': {
      // Home opens on the month summarised with its statement ready to make. A push sent before
      // the payload named the month means the month before the one it was sent in, which is
      // "last month" while the owner taps it in the same month.
      const from = data?.from;
      const to = data?.to;
      return isPlainDate(from) && isPlainDate(to) && from <= to
        ? { pathname: '/(tabs)', params: { from, to, statement: '1' } }
        : { pathname: '/(tabs)', params: { preset: 'last_month', statement: '1' } };
    }
    case 'new_device_login':
      return '/settings';
    // The push carries the answer's id; the thread screen opens the thread it belongs to.
    case 'message_reply':
      return id ? { pathname: '/message/[id]', params: { id } } : '/messages';
    // The push carries the approval's id: the owner approves or declines on that screen.
    case 'repair_approval_needed':
      return id ? { pathname: '/repair-approval/[id]', params: { id } } : '/repair-approvals';
    default:
      return '/(tabs)';
  }
}

/**
 * What a notification that arrives while the app is open makes out of date: the query keys (by
 * prefix) to fetch again, so the screen behind the banner is current when the owner looks.
 */
export function refreshKeysFor(data: PushData | null | undefined): string[][] {
  const type = typeof data?.type === 'string' ? data.type : '';
  const id = typeof data?.entityId === 'string' ? data.entityId : '';
  const one = (key: string) => (id ? [[key, id]] : []);
  switch (type) {
    case 'cheque_due_soon':
    case 'cheque_bounced':
      return [['cheques'], ...one('cheque'), ['summary'], ['home'], ['calendar']];
    case 'contract_ending_60':
    case 'contract_ending_30':
      return [['units'], ['summary'], ['calendar']];
    case 'budget_threshold':
      return [['budgets']];
    case 'hearing_soon':
      return [['disputes'], ...one('dispute'), ['calendar']];
    case 'work_order_done':
      return [['work-orders'], ...one('work-order'), ['summary']];
    case 'large_expense':
      return [['expenses'], ...one('expense'), ['summary'], ['budgets']];
    case 'monthly_summary':
      return [['summary']];
    case 'new_device_login':
      return [['devices']];
    case 'message_reply':
      // The list (unread counts) and every open thread share the prefix.
      return [['messages']];
    case 'repair_approval_needed':
      return [['approvals'], ...one('approval'), ['work-orders']];
    default:
      return [];
  }
}
