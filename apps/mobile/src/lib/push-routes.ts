/**
 * Where a tapped push notification takes the owner. The API puts `type` and `entityId` in the
 * notification data (apps/api/src/services/notifications.ts); everything else is derived here so
 * the same table serves the phone and the tests.
 */
export type PushHref = string | { pathname: string; params: Record<string, string> };

export interface PushData {
  type?: unknown;
  entityId?: unknown;
}

export function routeForNotification(data: PushData | null | undefined): PushHref {
  const type = typeof data?.type === 'string' ? data.type : '';
  const id = typeof data?.entityId === 'string' ? data.entityId : '';
  switch (type) {
    case 'cheque_due_soon':
    case 'cheque_bounced':
      return id ? { pathname: '/cheque/[id]', params: { id } } : '/(tabs)/cheques';
    case 'contract_ending_60':
    case 'contract_ending_30':
      return '/(tabs)/properties';
    case 'hearing_soon':
      return id ? { pathname: '/dispute/[id]', params: { id } } : '/(tabs)/disputes';
    case 'work_order_done':
      return id ? { pathname: '/work-order/[id]', params: { id } } : '/work-orders';
    case 'large_expense':
      return id ? { pathname: '/expense/[id]', params: { id } } : '/(tabs)/expenses';
    case 'monthly_summary':
      return { pathname: '/(tabs)', params: { preset: 'last_month' } };
    case 'new_device_login':
      return '/settings';
    default:
      return '/(tabs)';
  }
}
