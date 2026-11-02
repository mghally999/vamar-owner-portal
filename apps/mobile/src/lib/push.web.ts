/** The owner web app has no push channel; the settings switch explains that it is unavailable. */
import type { PushHref } from './push-routes';

export { routeForNotification } from './push-routes';

export function usePushNavigation(_navigate: (href: PushHref) => void, _enabled: boolean): void {
  // nothing to listen to on the web
}
export type PushState = 'registered' | 'off' | 'denied' | 'unsupported' | 'failed';

export function notificationsEnabled(): Promise<boolean> {
  return Promise.resolve(false);
}

export function lastPushState(): Promise<PushState | null> {
  return Promise.resolve('unsupported');
}

export function registerForPush(): Promise<PushState> {
  return Promise.resolve('unsupported');
}

export function setNotifications(_on: boolean): Promise<PushState> {
  return Promise.resolve('unsupported');
}
