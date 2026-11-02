// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, reply, type ApiCall } from '@/test/api';
import { mockApi } from '@/test/api';
import { staffUser } from '@/test/fixtures';
import {
  ApiRequestError,
  getAccessToken,
  getCachedUser,
  hasSessionFlag,
  qs,
  refreshStaffSession,
  request,
  setAccessToken,
  setCachedUser,
  setSessionFlag,
  setSessionLostHandler,
} from './api';

beforeEach(() => {
  localStorage.clear();
  setAccessToken(null);
  setCachedUser(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request', () => {
  it('sends JSON with the access token and returns the parsed body', async () => {
    const api = mockApi({ 'POST /api/staff/owners': { id: 'own-1' } });
    setAccessToken('access-1');
    const out = await request<{ id: string }>('/api/staff/owners', {
      method: 'POST',
      body: JSON.stringify({ nameEn: 'Ahmed' }),
    });
    expect(out).toEqual({ id: 'own-1' });
    const call = api.last('POST', '/api/staff/owners');
    expect(call.body).toEqual({ nameEn: 'Ahmed' });
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('authorization')).toBe('Bearer access-1');
    expect(api.fetch.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('leaves the content type of a form upload to the browser', async () => {
    const api = mockApi({ 'POST /api/staff/attachments': { id: 'att-1' } });
    const form = new FormData();
    form.set('file', new File(['x'], 'a.pdf'));
    await request('/api/staff/attachments', { method: 'POST', body: form });
    expect(api.last('POST', '/api/staff/attachments').headers.get('content-type')).toBeNull();
  });

  it('turns an API error body into an ApiRequestError', async () => {
    mockApi({
      'GET /api/staff/owners/x': apiError(409, 'conflict', 'Phone in use', { field: 'phone' }),
    });
    const err = await request('/api/staff/owners/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'Phone in use',
      details: { field: 'phone' },
    });
  });

  it('falls back to the status text when the error is not JSON', async () => {
    mockApi({
      'GET /api/staff/overview': () =>
        new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      'GET /api/staff/staff': () => new Response('', { status: 500 }),
    });
    await expect(request('/api/staff/overview')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
      message: 'Bad Gateway',
    });
    await expect(request('/api/staff/staff')).rejects.toMatchObject({
      message: 'Request failed',
    });
  });

  it('refreshes an expired token once and replays the request', async () => {
    const api = mockApi({
      'GET /api/staff/overview': (c: ApiCall) =>
        c.headers.get('authorization') === 'Bearer fresh'
          ? { month: '2026-10' }
          : apiError(401, 'unauthenticated'),
      'POST /api/auth/staff/refresh': { accessToken: 'fresh', user: staffUser('editor') },
    });
    setAccessToken('stale');
    await expect(request('/api/staff/overview')).resolves.toEqual({ month: '2026-10' });
    expect(api.to('GET', '/api/staff/overview')).toHaveLength(2);
    expect(getAccessToken()).toBe('fresh');
    expect(getCachedUser()?.role).toBe('editor');
    expect(hasSessionFlag()).toBe(true);
  });

  it('ends the session only when the refresh is refused', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    setSessionFlag(true);
    mockApi({
      'GET /api/staff/overview': apiError(401, 'unauthenticated'),
      'POST /api/auth/staff/refresh': apiError(401, 'unauthenticated'),
    });
    await expect(request('/api/staff/overview')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(hasSessionFlag()).toBe(false);
  });

  it('keeps the session through a refresh server error', async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    mockApi({
      'GET /api/staff/overview': apiError(401, 'unauthenticated'),
      'POST /api/auth/staff/refresh': reply(503),
    });
    await expect(request('/api/staff/overview')).rejects.toMatchObject({ status: 401 });
    expect(lost).not.toHaveBeenCalled();
  });

  it('never refreshes for the sign-in routes themselves', async () => {
    const api = mockApi({ 'POST /api/auth/staff/totp/verify': apiError(401, 'totp_invalid') });
    await expect(
      request('/api/auth/staff/totp/verify', { method: 'POST', body: '{"code":"1"}' }),
    ).rejects.toMatchObject({ code: 'totp_invalid' });
    expect(api.to('POST', '/api/auth/staff/refresh')).toHaveLength(0);
  });
});

describe('refreshStaffSession', () => {
  it('shares one refresh between concurrent callers', async () => {
    const api = mockApi({
      'POST /api/auth/staff/refresh': { accessToken: 't', user: staffUser() },
    });
    const [a, b] = await Promise.all([refreshStaffSession(), refreshStaffSession()]);
    expect(a).toEqual({ ok: true, token: 't' });
    expect(b).toEqual(a);
    expect(api.to('POST', '/api/auth/staff/refresh')).toHaveLength(1);
  });

  it('reports a network failure as transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(refreshStaffSession()).resolves.toEqual({ ok: false, reason: 'transient' });
  });

  it('treats a forbidden refresh as signed out', async () => {
    setSessionFlag(true);
    mockApi({ 'POST /api/auth/staff/refresh': apiError(403, 'disabled') });
    await expect(refreshStaffSession()).resolves.toEqual({
      ok: false,
      reason: 'unauthenticated',
    });
    expect(hasSessionFlag()).toBe(false);
  });
});

describe('session flag', () => {
  it('is remembered in local storage', () => {
    expect(hasSessionFlag()).toBe(false);
    setSessionFlag(true);
    expect(localStorage.getItem('vamar_staff_session')).toBe('1');
    expect(hasSessionFlag()).toBe(true);
    setSessionFlag(false);
    expect(hasSessionFlag()).toBe(false);
  });

  it('assumes a session may exist when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(hasSessionFlag()).toBe(true);
    expect(() => {
      setSessionFlag(true);
    }).not.toThrow();
  });
});

describe('qs', () => {
  it('leaves out empty values and encodes the rest', () => {
    expect(qs({ search: 'Al Noor & Co', status: '', cursor: undefined, ownerId: null })).toBe(
      '?search=Al+Noor+%26+Co',
    );
    expect(qs({ limit: 50, archived: false })).toBe('?limit=50&archived=false');
    expect(qs({})).toBe('');
  });
});
