/**
 * Expo push registration. Asks for permission after sign-in (again only from the Settings switch
 * once the owner has refused), registers the token with the API for this device, follows token
 * changes, and removes it when the owner turns notifications off or signs out. The outcome is
 * kept so the settings screen can say when notifications are switched on but not actually
 * reaching this phone.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { request } from './api';
import { refreshKeysFor, routeForNotification, type PushHref } from './push-routes';
import { deviceId, getItem, setItem } from './storage';

export { routeForNotification } from './push-routes';

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

export type PushState = 'registered' | 'off' | 'denied' | 'unsupported' | 'failed';

export async function notificationsEnabled(): Promise<boolean> {
  return (await getItem('notifications')) !== '0';
}

export async function lastPushState(): Promise<PushState | null> {
  const v = await getItem('pushState');
  return (v as PushState | null) ?? null;
}

async function remember(state: PushState): Promise<PushState> {
  await setItem('pushState', state);
  return state;
}

/**
 * Registers this device for push and reports what happened. `ask` shows the system prompt when
 * permission is missing; by default only while the owner has not refused it before, so a refusal
 * is not met with the prompt on every launch (the Settings switch asks again).
 */
export async function registerForPush(options: { ask?: boolean } = {}): Promise<PushState> {
  // An iOS simulator gets no push token. An Android emulator with Google Play services does,
  // like a phone, so it registers (and push delivery can be tested on it).
  if (!Device.isDevice && Platform.OS !== 'android') return remember('unsupported');
  if (!(await notificationsEnabled())) return remember('off');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Vamar',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  const ask = options.ask ?? (await lastPushState()) !== 'denied';
  // Android after "don't ask again", iOS after the first answer: the prompt would not show.
  const blocked = 'canAskAgain' in current && !current.canAskAgain;
  if (status !== Notifications.PermissionStatus.GRANTED && ask && !blocked)
    status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== Notifications.PermissionStatus.GRANTED) return remember('denied');
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  try {
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
      .data;
    await request('/api/owner/push-token', {
      method: 'POST',
      body: JSON.stringify({ deviceId: await deviceId(), pushToken: token }),
    });
    return await remember('registered');
  } catch (e) {
    if (__DEV__) console.warn('[push] registration failed', e);
    return remember('failed');
  }
}

export async function setNotifications(on: boolean): Promise<PushState> {
  await setItem('notifications', on ? '1' : '0');
  if (on) return registerForPush({ ask: true });
  await forgetPushToken();
  return remember('off');
}

/**
 * Removes this phone's push token from the API: when the owner turns notifications off, and on
 * sign-out (the session ends but the device row, and its token, would stay, so a signed-out
 * phone would keep receiving the owner's notifications). Best effort.
 */
export async function forgetPushToken(): Promise<void> {
  try {
    await request('/api/owner/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId: await deviceId() }),
    });
  } catch (e) {
    // Offline: the server drops the token on the next failed push anyway.
    if (__DEV__) console.warn('[push] could not remove the token now', e);
  }
}

/** The tap already handled in this run, so the launch tap and its listener event open it once. */
let handledTap: string | null = null;

function tapKey(response: Notifications.NotificationResponse): string | null {
  const id = (response.notification.request as { identifier?: string }).identifier;
  return id ? `${id}/${response.actionIdentifier}` : null;
}

/**
 * Opens the screen behind a tapped notification: the one that launched the app (cold start) and
 * any tapped while it runs. Called once from the root layout once the owner is signed in. The
 * launch tap is cleared once handled: the phone keeps it across a reload (the language switch
 * reloads the app) and a later sign-in, which would otherwise open the old screen again.
 */
export function usePushNavigation(navigate: (href: PushHref) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const open = (response: Notifications.NotificationResponse) => {
      const key = tapKey(response);
      if (key !== null && key === handledTap) return;
      handledTap = key;
      navigate(routeForNotification(response.notification.request.content.data));
    };
    const launched = Notifications.getLastNotificationResponse();
    if (launched) {
      open(launched);
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        // Older native module: the in-memory key above still stops a repeat in this run.
      }
    }
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      sub.remove();
    };
  }, [enabled, navigate]);
}

/**
 * The device token the token listener last acted on. Asking for the token, as every registration
 * does, makes expo-notifications announce it again as if it were new; acting on each announcement
 * registered in an endless loop (hundreds of requests a minute while the app was open, and a
 * token put back right after sign-out removed it). Only a token that changed is registered.
 */
let lastAnnouncedToken: string | null = null;

/**
 * While the owner is signed in: a notification that arrives with the app open refreshes what it
 * makes out of date (see refreshKeysFor), and a new push token from the phone (FCM/APNs rotate
 * them) is registered at once instead of at the next launch.
 */
export function usePushUpdates(refresh: (keys: string[][]) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const received = Notifications.addNotificationReceivedListener((n) => {
      const keys = refreshKeysFor(n.request.content.data);
      if (keys.length) refresh(keys);
    });
    const token = Notifications.addPushTokenListener((t) => {
      const value = typeof t.data === 'string' ? t.data : JSON.stringify(t.data);
      if (value === lastAnnouncedToken) return;
      lastAnnouncedToken = value;
      void registerForPush({ ask: false });
    });
    return () => {
      received.remove();
      token.remove();
    };
  }, [enabled, refresh]);
}
