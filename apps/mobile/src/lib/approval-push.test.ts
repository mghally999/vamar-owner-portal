import { describe, expect, it } from 'vitest';
import { routeWithApprovals } from './approval-push';
import { routeForNotification } from './push-routes';

describe('routeWithApprovals', () => {
  it('opens the approval request a push is about', () => {
    expect(routeWithApprovals({ type: 'repair_approval_needed', entityId: 'ap-1' })).toEqual({
      pathname: '/repair-approval/[id]',
      params: { id: 'ap-1' },
    });
    expect(routeWithApprovals({ type: 'repair_approval_needed' })).toBe('/repair-approvals');
    expect(routeWithApprovals({ type: 'repair_approval_needed', entityId: 7 })).toBe(
      '/repair-approvals',
    );
  });

  it('leaves every other notification to the existing table', () => {
    for (const data of [
      { type: 'cheque_bounced', entityId: 'q1' },
      { type: 'work_order_done', entityId: 'w1' },
      { type: 'new_device_login' },
      null,
    ])
      expect(routeWithApprovals(data)).toEqual(routeForNotification(data));
  });
});
