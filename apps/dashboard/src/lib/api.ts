/**
 * Typed API client. `hc<AppType>` gives end-to-end types from the Hono routes. The access
 * token lives in memory only; on a 401 we try one cookie refresh and replay the request.
 */
import { hc } from 'hono/client';
import type { AppType } from '@vamar/api';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

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

/**
 * Result of a cookie refresh. Only `unauthenticated` ends the session; a transient failure
 * (server error, rate limit, network) keeps the user signed in and the caller retries later.
 */
export type RefreshOutcome =
  { ok: true; token: string } | { ok: false; reason: 'unauthenticated' | 'transient' };

/**
 * The refresh cookie is httpOnly, so this flag remembers that a session may exist. It stops the
 * anonymous login page from asking the server (and logging a 401) on every visit.
 */
const SESSION_FLAG = 'vamar_staff_session';
export function hasSessionFlag(): boolean {
  try {
    return localStorage.getItem(SESSION_FLAG) === '1';
  } catch {
    return true;
  }
}
export function setSessionFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(SESSION_FLAG, '1');
    else localStorage.removeItem(SESSION_FLAG);
  } catch {
    // storage unavailable: the refresh call is simply attempted on load
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function refreshStaffSession(): Promise<RefreshOutcome> {
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    try {
      const res = await fetch(`${BASE}/api/auth/staff/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401 || res.status === 403) {
        setSessionFlag(false);
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!res.ok) return { ok: false, reason: 'transient' };
      const body: { accessToken: string; user: StaffUser } = await res.json();
      accessToken = body.accessToken;
      currentUser = body.user;
      setSessionFlag(true);
      return { ok: true, token: body.accessToken };
    } catch {
      return { ok: false, reason: 'transient' };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}
let currentUser: StaffUser | null = null;
export function getCachedUser() {
  return currentUser;
}
export function setCachedUser(u: StaffUser | null) {
  currentUser = u;
}

const authFetch: typeof fetch = async (input, init) => {
  const run = (token: string | null) => {
    const headers = new Headers(init?.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers, credentials: 'include' });
  };
  let res = await run(accessToken);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isAuthCall = url.includes('/api/auth/staff/');
  if (res.status === 401 && !isAuthCall) {
    // Expired or missing access token: one cookie refresh, then replay. Only a refusal ends the
    // session; a server hiccup leaves the 401 to the caller's retry policy.
    const next = await refreshStaffSession();
    if (next.ok) res = await run(next.token);
    else if (next.reason === 'unauthenticated') onSessionLost?.();
  }
  return res;
};

export const api = hc<AppType>(BASE, { fetch: authFetch });

/** Unwrap a Hono client response: JSON on success, ApiRequestError otherwise. */
export async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return await res.json();
  let body: ApiErrorBody | null = null;
  try {
    const parsed: ApiErrorBody = await res.json();
    body = parsed;
  } catch {
    // non-JSON error
  }
  const err = body?.error;
  if (err) throw new ApiRequestError(res.status, err.code, err.message, err.details);
  throw new ApiRequestError(res.status, 'http_error', res.statusText || 'Request failed');
}

/** Plain JSON helper for routes where the typed client is awkward (query strings, forms). */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await authFetch(`${BASE}${path}`, { ...init, headers });
  return unwrap<T>(res);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
