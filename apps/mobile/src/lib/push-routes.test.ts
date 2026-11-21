import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@vamar/shared/rules';
import { refreshKeysFor, routeForNotification } from './push-routes';

describe('routeForNotification', () => {
  it('opens a screen of its own for every kind the API sends, not the home tab', () => {
    // monthly_summary opens Home on purpose, with the month and its statement.
    for (const type of NOTIFICATION_TYPES) {
      const href = routeForNotification({
        type,
        entityId: 'e1',
        from: '2026-10-01',
        to: '2026-10-31',
      });
      if (type === 'monthly_summary') expect(href).toMatchObject({ params: { statement: '1' } });
      else expect(href, type).not.toBe('/(tabs)');
    }
  });

  it('opens the repair approval the push is about', () => {
    expect(routeForNotification({ type: 'repair_approval_needed', entityId: 'a1' })).toEqual({
      pathname: '/repair-approval/[id]',
      params: { id: 'a1' },
    });
    expect(routeForNotification({ type: 'repair_approval_needed' })).toBe('/repair-approvals');
  });

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
    // A reply opens its thread through the answer's id; without one, the list of threads.
    expect(routeForNotification({ type: 'message_reply', entityId: 'msg-1' })).toEqual({
      pathname: '/message/[id]',
      params: { id: 'msg-1' },
    });
    expect(routeForNotification({ type: 'message_reply' })).toBe('/messages');
    expect(routeForNotification({ type: 'something_else' })).toBe('/(tabs)');
    expect(routeForNotification(null)).toBe('/(tabs)');
    expect(routeForNotification({ type: 42, entityId: 7 })).toBe('/(tabs)');
  });
});

describe('refreshKeysFor', () => {
  it('names what each kind of notification makes out of date', () => {
    expect(refreshKeysFor({ type: 'cheque_bounced', entityId: 'q1' })).toEqual([
      ['cheques'],
      ['cheque', 'q1'],
      ['summary'],
      ['home'],
      ['calendar'],
    ]);
    expect(refreshKeysFor({ type: 'message_reply', entityId: 'm1' })).toEqual([['messages']]);
    expect(refreshKeysFor({ type: 'repair_approval_needed', entityId: 'a1' })).toEqual([
      ['approvals'],
      ['approval', 'a1'],
      ['work-orders'],
    ]);
    expect(refreshKeysFor({ type: 'large_expense' })).toEqual([
      ['expenses'],
      ['summary'],
      ['budgets'],
    ]);
    expect(refreshKeysFor({ type: 'budget_threshold' })).toEqual([['budgets']]);
    expect(refreshKeysFor({ type: 'hearing_soon', entityId: 'd1' })).toContainEqual([
      'dispute',
      'd1',
    ]);
    expect(refreshKeysFor({ type: 'work_order_done', entityId: 'w1' })).toContainEqual([
      'work-order',
      'w1',
    ]);
    expect(refreshKeysFor({ type: 'contract_ending_30' })).toContainEqual(['units']);
    expect(refreshKeysFor({ type: 'monthly_summary' })).toEqual([['summary']]);
    expect(refreshKeysFor({ type: 'new_device_login' })).toEqual([['devices']]);
  });

  it('refreshes nothing for an unknown or missing type', () => {
    expect(refreshKeysFor({ type: 'something_new' })).toEqual([]);
    expect(refreshKeysFor(null)).toEqual([]);
  });
});
