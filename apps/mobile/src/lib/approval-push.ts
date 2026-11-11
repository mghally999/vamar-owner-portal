/**
 * Where a tapped push goes, including the "approval needed" push. The request is the
 * notification's entity, so the tap opens it; every other type keeps the table in push-routes.ts.
 */
import { routeForNotification, type PushData, type PushHref } from './push-routes';

export function routeWithApprovals(data: PushData | null | undefined): PushHref {
  if (data?.type === 'repair_approval_needed') {
    const id = typeof data.entityId === 'string' ? data.entityId : '';
    return id ? { pathname: '/approval/[id]', params: { id } } : '/approvals';
  }
  return routeForNotification(data);
}
