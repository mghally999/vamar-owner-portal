/**
 * Expo push registration. Asks for permission once after sign-in, registers the token with the
 * API for this device, and removes it when the owner turns notifications off.
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

export async function notificationsEnabled(): Promise<boolean> {
  return (await getItem('notifications')) !== '0';
}

/** Returns the Expo push token or null when unavailable (simulator, permission denied, off). */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (!(await notificationsEnabled())) return null;
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
  if (status !== Notifications.PermissionStatus.GRANTED) return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  try {
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
      .data;
    await request('/api/owner/push-token', {
      method: 'POST',
      body: JSON.stringify({ deviceId: await deviceId(), pushToken: token }),
    });
    return token;
  } catch {
    return null;
  }
}

export async function setNotifications(on: boolean): Promise<void> {
  await setItem('notifications', on ? '1' : '0');
  if (on) await registerForPush();
  else {
    try {
      await request('/api/owner/push-token', {
        method: 'DELETE',
        body: JSON.stringify({ deviceId: await deviceId() }),
      });
    } catch {
      // offline; the token is dropped on next failed push anyway
    }
  }
}
