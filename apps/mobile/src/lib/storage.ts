/**
 * Secure storage for tokens and small preferences. Everything sensitive lives in the device
 * keychain / keystore through expo-secure-store; nothing is written to AsyncStorage.
 */
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  accessToken: 'vamar.access',
  refreshToken: 'vamar.refresh',
  deviceId: 'vamar.device',
  lang: 'vamar.lang',
  biometrics: 'vamar.biometrics',
  notifications: 'vamar.notifications',
  owner: 'vamar.owner',
} as const;

export type StorageKey = keyof typeof KEYS;

export async function getItem(key: StorageKey): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS[key]);
  } catch {
    return null;
  }
}

export async function setItem(key: StorageKey, value: string | null): Promise<void> {
  try {
    if (value === null) await SecureStore.deleteItemAsync(KEYS[key]);
    else
      await SecureStore.setItemAsync(KEYS[key], value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
  } catch {
    // storage unavailable; the session simply will not persist
  }
}

/** A stable per-install id, generated once. */
export async function deviceId(): Promise<string> {
  const existing = await getItem('deviceId');
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await setItem('deviceId', id);
  return id;
}
