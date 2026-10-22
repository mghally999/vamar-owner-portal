/**
 * API client for the owner app. Access token in memory, refresh token in SecureStore, one
 * refresh attempt on 401. Only a refused refresh (401/403: revoked device, disabled owner) signs
 * the owner out; a server error or a dead connection keeps the session and the caller retries.
 * Base URL from EXPO_PUBLIC_API_BASE.
 */
import { Platform } from 'react-native';
import { deviceId, getItem, setItem } from './storage';

export const API_BASE = (
  process.env.EXPO_PUBLIC_API_BASE ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787')
).replace(/\/$/, '');

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<RefreshOutcome> | null = null;
let onSessionLost: (() => void) | null = null;

export type RefreshOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: 'no_session' | 'unauthenticated' | 'transient' };

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export async function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    try {
      const refreshToken = await getItem('refreshToken');
      if (!refreshToken) return { ok: false, reason: 'no_session' };
      const res = await fetch(`${API_BASE}/api/auth/owner/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId: await deviceId() }),
      });
      if (res.status === 401 || res.status === 403) {
        await setItem('refreshToken', null);
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!res.ok) return { ok: false, reason: 'transient' };
      const body = (await res.json()) as TokenPair;
      accessToken = body.accessToken;
      await setItem('refreshToken', body.refreshToken);
      return { ok: true, token: body.accessToken };
    } catch {
      return { ok: false, reason: 'transient' };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const run = async (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
    headers.set('accept-language', 'ar');
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  let res = await run(accessToken);
  if (res.status === 401 && accessToken) {
    const next = await refreshSession();
    if (next.ok) res = await run(next.token);
    else if (next.reason !== 'transient') onSessionLost?.();
  }
  if (res.ok) return (await res.json()) as T;
  let code = 'http_error';
  let message = res.statusText || 'Request failed';
  let details: unknown;
  try {
    const body = (await res.json()) as {
      error?: { code: string; message: string; details?: unknown };
    };
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
      details = body.error.details;
    }
  } catch {
    // ignore
  }
  throw new ApiRequestError(res.status, code, message, details);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Headers for authenticated images rendered by expo-image (cached on disk by URL). */
export function authHeaders(): Record<string, string> {
  return accessToken ? { authorization: `Bearer ${accessToken}` } : {};
}
