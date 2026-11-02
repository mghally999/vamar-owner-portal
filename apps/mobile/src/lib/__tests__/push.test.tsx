import { Platform } from 'react-native';
import { lastPushState, notificationsEnabled, registerForPush, setNotifications } from '@/lib/push';
import { getItem, setItem } from '@/lib/storage';
import { mockApi, offline, sent } from '@/test/api';
import { constants, device, notifications } from '@/test/native';

interface Handler {
  handleNotification: () => Promise<Record<string, boolean>>;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockApi({
    'POST /api/owner/push-token': { body: { ok: true } },
    'DELETE /api/owner/push-token': { body: { ok: true } },
  });
});

describe('push registration', () => {
  it('shows notifications as banners with sound while the app is open', async () => {
    const [handler] = notifications.setNotificationHandler.mock.calls[0] as [Handler];
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it('registers the Expo token for this device with the API', async () => {
    await expect(registerForPush()).resolves.toBe('registered');
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'eas-project-1',
    });
    expect(sent('POST /api/owner/push-token')[0]?.body).toEqual({
      deviceId: 'IOS-VENDOR-0001',
      pushToken: 'ExponentPushToken[device-1]',
    });
    expect(await lastPushState()).toBe('registered');
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('creates the Android channel and works without an EAS project id', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    constants.expoConfig = null;
    await expect(registerForPush()).resolves.toBe('registered');
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'Vamar', importance: 3 }),
    );
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith(undefined);
  });

  it('asks for permission once and remembers a refusal', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(registerForPush()).resolves.toBe('denied');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(sent('POST /api/owner/push-token')).toHaveLength(0);
    expect(await lastPushState()).toBe('denied');
  });

  it('registers after the owner grants permission when asked', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    await expect(registerForPush()).resolves.toBe('registered');
  });

  it('reports a simulator as unsupported and does nothing else', async () => {
    device.isDevice = false;
    await expect(registerForPush()).resolves.toBe('unsupported');
    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not register while the owner has notifications off', async () => {
    await setItem('notifications', '0');
    expect(await notificationsEnabled()).toBe(false);
    await expect(registerForPush()).resolves.toBe('off');
    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a failed registration when the API cannot be reached', async () => {
    mockApi({ 'POST /api/owner/push-token': offline() });
    await expect(registerForPush()).resolves.toBe('failed');
    expect(await lastPushState()).toBe('failed');
  });
});

describe('notification switch', () => {
  it('is on until the owner turns it off', async () => {
    expect(await notificationsEnabled()).toBe(true);
    expect(await lastPushState()).toBeNull();
  });

  it('turning on stores the choice and registers', async () => {
    await expect(setNotifications(true)).resolves.toBe('registered');
    expect(await getItem('notifications')).toBe('1');
  });

  it('turning off removes this device token from the API', async () => {
    await expect(setNotifications(false)).resolves.toBe('off');
    expect(await getItem('notifications')).toBe('0');
    expect(sent('DELETE /api/owner/push-token')[0]?.body).toEqual({
      deviceId: 'IOS-VENDOR-0001',
    });
  });

  it('turning off while offline still switches off', async () => {
    mockApi({ 'DELETE /api/owner/push-token': offline() });
    await expect(setNotifications(false)).resolves.toBe('off');
    expect(await lastPushState()).toBe('off');
  });
});
