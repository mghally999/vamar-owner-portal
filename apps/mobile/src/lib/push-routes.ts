/**
 * Where a tapped push notification takes the owner. The API puts `type` and `entityId` in the
 * notification data (apps/api/src/services/notifications.ts), and the monthly summary also the
 * month it summarises (`from`, `to`); everything else is derived here so the same table serves
 * the phone and the tests.
 */
import { isPlainDate } from '@vamar/shared';

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
    default:
      return '/(tabs)';
  }
}
