import {
  ApiRequestError,
  API_BASE,
  authHeaders,
  getAccessToken,
  qs,
  refreshSession,
  request,
  setAccessToken,
  setSessionLostHandler,
} from '@/lib/api';
import { getItem, setItem } from '@/lib/storage';
import { fetchMock, mockApi, offline, sent } from '@/test/api';

const tokens = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  refreshExpiresAt: '2026-12-01T00:00:00Z',
};

const sessionLost = jest.fn();

beforeEach(() => {
  setAccessToken(null);
  sessionLost.mockReset();
  setSessionLostHandler(sessionLost);
});

describe('request', () => {
  it('sends the bearer token and Arabic as the language, and returns the JSON body', async () => {
    setAccessToken('access-1');
    mockApi({ 'GET /api/owner/me': { body: { id: 'owner-1' } } });
    await expect(request('/api/owner/me')).resolves.toEqual({ id: 'owner-1' });
    const [req] = sent('GET /api/owner/me');
    expect(req?.url).toBe(`${API_BASE}/api/owner/me`);
    expect(req?.headers.get('authorization')).toBe('Bearer access-1');
    expect(req?.headers.get('accept-language')).toBe('ar');
    expect(req?.headers.get('content-type')).toBeNull();
  });

  it('marks a string body as JSON and sends no token when signed out', async () => {
    mockApi({ 'POST /api/owner/account/delete-request': { body: { ok: true } } });
    await request('/api/owner/account/delete-request', {
      method: 'POST',
      body: JSON.stringify({ reason: '' }),
    });
    const [req] = sent('POST /api/owner/account/delete-request');
    expect(req?.headers.get('content-type')).toBe('application/json');
    expect(req?.headers.get('authorization')).toBeNull();
    expect(req?.body).toEqual({ reason: '' });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('expired');
    await setItem('refreshToken', 'refresh-1');
    mockApi({
      'GET /api/owner/home': (req) =>
        req.headers.get('authorization') === 'Bearer access-2'
          ? { body: { expectedFils: 1 } }
          : { status: 401, body: { error: { code: 'unauthenticated', message: 'Expired' } } },
      'POST /api/auth/owner/refresh': { body: tokens },
    });
    await expect(request('/api/owner/home')).resolves.toEqual({ expectedFils: 1 });
    expect(getAccessToken()).toBe('access-2');
    expect(await getItem('refreshToken')).toBe('refresh-2');
    expect(sent('POST /api/auth/owner/refresh')[0]?.body).toEqual({
      refreshToken: 'refresh-1',
      deviceId: 'IOS-VENDOR-0001',
    });
    expect(sent('GET /api/owner/home')).toHaveLength(2);
    expect(sessionLost).not.toHaveBeenCalled();
  });

  it('signs the owner out when the refresh is refused', async () => {
    setAccessToken('expired');
    await setItem('refreshToken', 'refresh-1');
    mockApi({
      'GET /api/owner/home': {
        status: 401,
        body: { error: { code: 'unauthenticated', message: 'No' } },
      },
      'POST /api/auth/owner/refresh': { status: 403, body: {} },
    });
    await expect(request('/api/owner/home')).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
      message: 'No',
    });
    expect(sessionLost).toHaveBeenCalledTimes(1);
    expect(await getItem('refreshToken')).toBeNull();
  });

  it('keeps the session when the refresh fails for a server or network reason', async () => {
    setAccessToken('expired');
    await setItem('refreshToken', 'refresh-1');
    mockApi({
      'GET /api/owner/home': { status: 401, body: {} },
      'POST /api/auth/owner/refresh': { status: 503, body: {} },
    });
    await expect(request('/api/owner/home')).rejects.toBeInstanceOf(ApiRequestError);
    mockApi({ 'POST /api/auth/owner/refresh': offline() });
    await expect(request('/api/owner/home')).rejects.toBeInstanceOf(ApiRequestError);
    expect(sessionLost).not.toHaveBeenCalled();
    expect(await getItem('refreshToken')).toBe('refresh-1');
  });

  it('does not try to refresh a 401 when there was no token', async () => {
    mockApi({ 'GET /api/owner/me': { status: 401, statusText: 'Unauthorized' } });
    await expect(request('/api/owner/me')).rejects.toMatchObject({
      status: 401,
      code: 'http_error',
      message: 'Unauthorized',
    });
    expect(sent('POST /api/auth/owner/refresh')).toHaveLength(0);
  });

  it('turns an error body into an ApiRequestError with its code and details', async () => {
    mockApi({
      'POST /api/auth/owner/exchange': {
        status: 422,
        body: { error: { code: 'validation', message: 'Bad phone', details: { field: 'phone' } } },
      },
    });
    const err = (await request('/api/auth/owner/exchange', { method: 'POST' }).catch(
      (e: unknown) => e,
    )) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('validation');
    expect(err.details).toEqual({ field: 'phone' });
  });

  it('falls back to a generic message for an error without a body or text', async () => {
    mockApi({
      'GET /api/owner/me': { status: 500 },
      'GET /api/owner/buildings': { status: 500, body: { message: 'not our shape' } },
    });
    await expect(request('/api/owner/me')).rejects.toMatchObject({
      code: 'http_error',
      message: 'Request failed',
    });
    await expect(request('/api/owner/buildings')).rejects.toMatchObject({ code: 'http_error' });
  });

  it('lets a dead connection reach the caller', async () => {
    mockApi({ 'GET /api/owner/me': offline() });
    await expect(request('/api/owner/me')).rejects.toThrow('Network request failed');
  });
});

describe('refreshSession', () => {
  it('reports no session without a stored refresh token, without calling the API', async () => {
    await expect(refreshSession()).resolves.toEqual({ ok: false, reason: 'no_session' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares one refresh between concurrent callers', async () => {
    await setItem('refreshToken', 'refresh-1');
    mockApi({ 'POST /api/auth/owner/refresh': { body: tokens } });
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toEqual({ ok: true, token: 'access-2' });
    expect(b).toBe(a);
    expect(sent('POST /api/auth/owner/refresh')).toHaveLength(1);
    // The next call starts a new refresh.
    await refreshSession();
    expect(sent('POST /api/auth/owner/refresh')).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('builds a query string without empty values', () => {
    expect(qs({ month: '2026-10', buildingId: undefined, status: null, q: '', limit: 50 })).toBe(
      '?month=2026-10&limit=50',
    );
    expect(qs({ cursor: undefined, active: false })).toBe('?active=false');
    expect(qs({})).toBe('');
  });

  it('gives image requests the bearer header only when signed in', () => {
    expect(authHeaders()).toEqual({});
    setAccessToken('access-9');
    expect(authHeaders()).toEqual({ authorization: 'Bearer access-9' });
  });

  it('keeps the base URL without a trailing slash', () => {
    expect(API_BASE).toMatch(/^https?:\/\/\S+[^/]$/);
  });
});
