/**
 * Secure storage for tokens and small preferences. Everything sensitive lives in the device
 * keychain / keystore through expo-secure-store; nothing is written to AsyncStorage.
 */
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEYS = {
  accessToken: 'vamar.access',
  refreshToken: 'vamar.refresh',
  deviceId: 'vamar.device',
  lang: 'vamar.lang',
  biometrics: 'vamar.biometrics',
  notifications: 'vamar.notifications',
  theme: 'vamar.theme',
  pushState: 'vamar.pushState',
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
/**
 * Opaque, stable id for this install: the Android ID / iOS vendor id (both reset on reinstall),
 * with a random fallback. Hermes has no global WebCrypto, so no `crypto` is used here.
 */
export async function deviceId(): Promise<string> {
  const existing = await getItem('deviceId');
  if (existing) return existing;
  let id: string | null;
  try {
    id =
      Platform.OS === 'android'
        ? Application.getAndroidId()
        : await Application.getIosIdForVendorAsync();
  } catch {
    id = null;
  }
  if (!id || id.length < 8) {
    id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
  await setItem('deviceId', id);
  return id;
}
