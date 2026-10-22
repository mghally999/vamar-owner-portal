/**
 * Expo push registration. Asks for permission once after sign-in, registers the token with the
 * API for this device, and removes it when the owner turns notifications off. The outcome is
 * kept so the settings screen can say when notifications are switched on but not actually
 * reaching this phone.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { request } from './api';
import { deviceId, getItem, setItem } from './storage';

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

/** Registers this device for push and reports what happened. */
export async function registerForPush(): Promise<PushState> {
  if (!Device.isDevice) return remember('unsupported');
  if (!(await notificationsEnabled())) return remember('off');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Vamar',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== Notifications.PermissionStatus.GRANTED)
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
  if (on) return registerForPush();
  try {
    await request('/api/owner/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId: await deviceId() }),
    });
  } catch (e) {
    // Offline: the server drops the token on the next failed push anyway.
    if (__DEV__) console.warn('[push] could not remove the token now', e);
  }
  return remember('off');
}
