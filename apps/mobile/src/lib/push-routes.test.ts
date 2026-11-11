import { describe, expect, it } from 'vitest';
import { routeForNotification } from './push-routes';

describe('routeForNotification', () => {
  it('opens the screen behind each kind of notification', () => {
    expect(routeForNotification({ type: 'cheque_due_soon', entityId: 'q1' })).toEqual({
      pathname: '/cheque/[id]',
      params: { id: 'q1' },
    });
    expect(routeForNotification({ type: 'cheque_bounced' })).toBe('/(tabs)/cheques');
    expect(routeForNotification({ type: 'contract_ending_30', entityId: 'c1' })).toBe(
      '/(tabs)/properties',
    );
    expect(routeForNotification({ type: 'budget_threshold', entityId: 'b1' })).toBe(
      '/(tabs)/properties',
    );
    expect(routeForNotification({ type: 'hearing_soon', entityId: 'd1' })).toEqual({
      pathname: '/dispute/[id]',
      params: { id: 'd1' },
    });
    expect(routeForNotification({ type: 'work_order_done', entityId: 'w1' })).toEqual({
      pathname: '/work-order/[id]',
      params: { id: 'w1' },
    });
    expect(routeForNotification({ type: 'work_order_done' })).toBe('/work-orders');
    expect(routeForNotification({ type: 'large_expense', entityId: 'x1' })).toEqual({
      pathname: '/expense/[id]',
      params: { id: 'x1' },
    });
    expect(routeForNotification({ type: 'large_expense' })).toBe('/(tabs)/expenses');
    expect(routeForNotification({ type: 'monthly_summary', entityId: 'o1' })).toEqual({
      pathname: '/(tabs)',
      params: { preset: 'last_month', statement: '1' },
    });
    expect(
      routeForNotification({
        type: 'monthly_summary',
        entityId: 'o1',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toEqual({
      pathname: '/(tabs)',
      params: { from: '2026-10-01', to: '2026-10-31', statement: '1' },
    });
    expect(routeForNotification({ type: 'new_device_login' })).toBe('/settings');
    expect(routeForNotification({ type: 'something_else' })).toBe('/(tabs)');
    expect(routeForNotification(null)).toBe('/(tabs)');
    expect(routeForNotification({ type: 42, entityId: 7 })).toBe('/(tabs)');
  });
});
