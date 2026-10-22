/// <reference lib="dom" />
/**
 * Storage for the owner web app (/app). Browsers have no keychain, so values live in
 * localStorage under the same names as on the phone. The page's strict CSP (no inline or third-
 * party script except Google's reCAPTCHA) is what protects them; signing out clears them.
 */
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

export function getItem(key: StorageKey): Promise<string | null> {
  let value: string | null = null;
  try {
    value = localStorage.getItem(KEYS[key]);
  } catch {
    // storage blocked (private mode): behave as empty
  }
  return Promise.resolve(value);
}

export function setItem(key: StorageKey, value: string | null): Promise<void> {
  try {
    if (value === null) localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], value);
  } catch {
    // private mode: the session lasts for this tab only
  }
  return Promise.resolve();
}

/** A random id per browser, kept so the device list in Settings stays stable. */
export async function deviceId(): Promise<string> {
  const existing = await getItem('deviceId');
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  await setItem('deviceId', id);
  return id;
}
