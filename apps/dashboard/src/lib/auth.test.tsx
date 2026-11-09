// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, reply } from '@/test/api';
import { staffUser } from '@/test/fixtures';
import { testQueryClient } from '@/test/render';
import { getAccessToken, setAccessToken } from './api';
import { AuthProvider, useAuth } from './auth';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(() => Promise.resolve('firebase-id-token')),
  firebaseSendVerificationEmail: vi.fn(),
}));

/** Shows the stage and gives the test the hook's functions. */
let current: ReturnType<typeof useAuth> | null = null;
function Probe() {
  current = useAuth();
  return <p>stage:{current.stage}</p>;
}

function renderAuth() {
  render(
    <QueryClientProvider client={testQueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const assign = vi.fn();

beforeEach(() => {
  localStorage.clear();
  setAccessToken(null);
  current = null;
  assign.mockReset();
  // The provider only reads the path and redirects with assign().
  vi.stubGlobal('location', {
    href: 'http://localhost/',
    origin: 'http://localhost',
    pathname: '/',
    search: '',
    assign,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AuthProvider', () => {
  it('starts signed out when the stored session is refused', async () => {
    localStorage.setItem('vamar_staff_session', '1');
    mockApi({
      'POST /api/auth/staff/refresh': reply(401, {
        error: { code: 'unauthenticated', message: 'x' },
      }),
    });
    renderAuth();
    expect(await screen.findByText('stage:anonymous')).toBeTruthy();
    expect(current?.hasRole('viewer')).toBe(false);
  });

  it('refreshes the access token on a timer and signs out when the refresh is refused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem('vamar_staff_session', '1');
    let refused = false;
    mockApi({
      'POST /api/auth/staff/refresh': () =>
        refused
          ? reply(401, { error: { code: 'unauthenticated', message: 'Session ended' } })
          : { accessToken: refused ? 'x' : 'access-1', user: staffUser('editor') },
    });
    renderAuth();
    expect(await screen.findByText('stage:authenticated')).toBeTruthy();
    expect(current?.hasRole('editor')).toBe(true);
    expect(current?.hasRole('admin')).toBe(false);
    // A server hiccup on a scheduled refresh keeps the session.
    mockApi({ 'POST /api/auth/staff/refresh': apiError(503, 'unavailable') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60_000);
    });
    expect(screen.getByText('stage:authenticated')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    // A refusal ends it and sends the browser to the login page.
    refused = true;
    mockApi({
      'POST /api/auth/staff/refresh': reply(401, {
        error: { code: 'unauthenticated', message: 'x' },
      }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60_000);
    });
    expect(await screen.findByText('stage:anonymous')).toBeTruthy();
    expect(assign).toHaveBeenCalledWith('/login?reason=expired');
    expect(getAccessToken()).toBeNull();
  });

  it('a request refused mid-session signs out and leaves the page for the login', async () => {
    localStorage.setItem('vamar_staff_session', '1');
    const routes = {
      'POST /api/auth/staff/refresh': { accessToken: 'access-1', user: staffUser('admin') },
      'GET /api/staff/overview': reply(401, { error: { code: 'unauthorized', message: 'x' } }),
    };
    mockApi(routes);
    renderAuth();
    expect(await screen.findByText('stage:authenticated')).toBeTruthy();
    // The access token is rejected and so is the cookie refresh behind it.
    mockApi({
      ...routes,
      'POST /api/auth/staff/refresh': reply(401, {
        error: { code: 'unauthenticated', message: 'x' },
      }),
    });
    const { request } = await import('./api');
    await act(async () => {
      await request('/api/staff/overview').catch(() => undefined);
    });
    expect(await screen.findByText('stage:anonymous')).toBeTruthy();
    expect(assign).toHaveBeenCalledWith('/login?reason=expired');
    expect(localStorage.getItem('vamar_staff_session')).toBeNull();
  });

  it('refuses the authenticator step without a sign-in first, and useAuth needs the provider', async () => {
    mockApi({});
    renderAuth();
    expect(await screen.findByText('stage:anonymous')).toBeTruthy();
    await expect(current!.totpVerify('123456')).rejects.toThrow('Sign in first');
    cleanup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useAuth outside AuthProvider');
    spy.mockRestore();
  });
});
