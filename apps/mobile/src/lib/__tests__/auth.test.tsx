import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState, Platform, Text, type AppStateStatus } from 'react-native';
import { setAccessToken, request } from '@/lib/api';
import {
  AccountDisabledError,
  AuthProvider,
  NotRegisteredError,
  useAuth,
  type AuthState,
} from '@/lib/auth';
import { getItem, setItem } from '@/lib/storage';
import { mockApi, offline, sent } from '@/test/api';
import { owner } from '@/test/fixtures';
import { localAuth, notifications } from '@/test/native';
import { seedSession } from '@/test/render';

let auth: AuthState | undefined;

function Probe() {
  auth = useAuth();
  return (
    <Text>
      {[
        auth.stage,
        auth.owner?.nameEn ?? 'nobody',
        auth.locked ? 'locked' : 'open',
        auth.biometricsEnabled ? 'bio-on' : 'bio-off',
        auth.biometricsAvailable ? 'bio-available' : 'no-bio',
        auth.justSignedIn ? 'new' : 'returning',
      ].join(' ')}
    </Text>
  );
}

function current(): AuthState {
  if (!auth) throw new Error('not rendered');
  return auth;
}

async function start() {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

const exchange = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  owner,
};

beforeEach(() => {
  auth = undefined;
  setAccessToken(null);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('resuming a session', () => {
  it('is anonymous without a stored session', async () => {
    await start();
    expect(await screen.findByText('anonymous nobody open bio-off no-bio returning')).toBeTruthy();
  });

  it('resumes from the refresh token, restores the owner and registers for push', async () => {
    await seedSession();
    await start();
    expect(
      await screen.findByText('authenticated Salem Al Kaabi open bio-off no-bio returning'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(sent('POST /api/owner/push-token')).toHaveLength(1);
    });
  });

  it('locks on open when the owner turned on Face ID / fingerprint', async () => {
    await seedSession();
    await setItem('biometrics', '1');
    localAuth.hasHardwareAsync.mockResolvedValue(true);
    await start();
    expect(
      await screen.findByText('authenticated Salem Al Kaabi locked bio-on bio-available returning'),
    ).toBeTruthy();
  });

  it('treats hardware without an enrolled face or finger as unavailable', async () => {
    localAuth.hasHardwareAsync.mockResolvedValue(true);
    localAuth.isEnrolledAsync.mockResolvedValue(false);
    await start();
    expect(await screen.findByText('anonymous nobody open bio-off no-bio returning')).toBeTruthy();
  });

  it('stays signed in offline with what was shown last, without registering for push', async () => {
    await seedSession();
    mockApi({ 'POST /api/auth/owner/refresh': offline() });
    await start();
    expect(await screen.findByText(/^authenticated Salem Al Kaabi/)).toBeTruthy();
    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('signs in again offline when no owner was saved', async () => {
    await setItem('refreshToken', 'refresh-1');
    mockApi({ 'POST /api/auth/owner/refresh': offline() });
    await start();
    expect(await screen.findByText(/^anonymous/)).toBeTruthy();
  });

  it('ends the session when the refresh is refused', async () => {
    await seedSession();
    mockApi({ 'POST /api/auth/owner/refresh': { status: 401, body: {} } });
    await start();
    expect(await screen.findByText(/^anonymous/)).toBeTruthy();
    expect(await getItem('refreshToken')).toBeNull();
  });

  it('falls back to signing in when the saved owner is unreadable', async () => {
    await seedSession();
    await setItem('owner', '{not json');
    await start();
    expect(await screen.findByText(/^anonymous/)).toBeTruthy();
  });

  it('gives up on a native call that hangs and treats it as no session', async () => {
    jest.useFakeTimers();
    try {
      localAuth.hasHardwareAsync.mockReturnValue(new Promise<boolean>(() => undefined));
      await start();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      expect(screen.getByText(/^anonymous/)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('signs the owner out when a later request finds the session revoked', async () => {
    await seedSession();
    await start();
    await screen.findByText(/^authenticated/);
    mockApi({
      'GET /api/owner/me': { status: 401, body: {} },
      'POST /api/auth/owner/refresh': { status: 401, body: {} },
    });
    await act(async () => {
      await request('/api/owner/me').catch(() => undefined);
    });
    expect(screen.getByText('anonymous nobody open bio-off no-bio returning')).toBeTruthy();
  });
});

describe('signing in', () => {
  it('sends the code, exchanges the Firebase token and stores the session', async () => {
    mockApi({
      'POST /api/auth/owner/exchange': { body: exchange },
      'POST /api/owner/push-token': { body: { ok: true } },
    });
    await start();
    await screen.findByText(/^anonymous/);
    await act(() => current().sendCode('+971501234567'));
    await act(() => current().verifyCode('123456'));
    expect(screen.getByText('authenticated Salem Al Kaabi open bio-off no-bio new')).toBeTruthy();
    expect(sent('POST /api/auth/owner/exchange')[0]?.body).toEqual({
      firebaseIdToken: 'id-token',
      device: { deviceId: 'IOS-VENDOR-0001', platform: 'ios', model: 'Pixel 8', pushToken: null },
    });
    expect(await getItem('refreshToken')).toBe('refresh-1');
    expect(JSON.parse((await getItem('owner')) ?? '')).toEqual(owner);
    await act(() => {
      current().clearJustSignedIn();
    });
    expect(screen.getByText(/returning$/)).toBeTruthy();
  });

  it.each([
    ['android', 'android'],
    ['web', 'web'],
  ] as const)('reports the %s platform to the API', async (os, platform) => {
    jest.replaceProperty(Platform, 'OS', os);
    mockApi({ 'POST /api/auth/owner/exchange': { body: exchange } });
    await start();
    await act(() => current().sendCode('+971501234567'));
    await act(() => current().verifyCode('123456'));
    expect(sent('POST /api/auth/owner/exchange')[0]?.body).toMatchObject({
      device: { platform },
    });
  });

  it('refuses a code before one was sent', async () => {
    await start();
    await expect(current().verifyCode('123456')).rejects.toThrow('No pending verification');
  });

  it('tells an unknown number and a disabled account apart from other failures', async () => {
    await start();
    await act(() => current().sendCode('+971501234567'));
    mockApi({
      'POST /api/auth/owner/exchange': {
        status: 403,
        body: { error: { code: 'owner_not_registered', message: 'Unknown number' } },
      },
    });
    await expect(current().verifyCode('123456')).rejects.toBeInstanceOf(NotRegisteredError);
    mockApi({
      'POST /api/auth/owner/exchange': {
        status: 403,
        body: { error: { code: 'owner_disabled', message: 'Disabled' } },
      },
    });
    await expect(current().verifyCode('123456')).rejects.toBeInstanceOf(AccountDisabledError);
    mockApi({ 'POST /api/auth/owner/exchange': { status: 500, body: {} } });
    await expect(current().verifyCode('123456')).rejects.toMatchObject({ status: 500 });
    expect(current().stage).toBe('anonymous');
  });
});

describe('signing out', () => {
  it('revokes the refresh token on the server and forgets the session', async () => {
    await seedSession();
    mockApi({ 'POST /api/auth/owner/logout': { body: { ok: true } } });
    await start();
    await screen.findByText(/^authenticated/);
    await act(() => current().signOut());
    expect(sent('POST /api/auth/owner/logout')[0]?.body).toEqual({ refreshToken: 'refresh-2' });
    expect(screen.getByText('anonymous nobody open bio-off no-bio returning')).toBeTruthy();
    expect(await getItem('refreshToken')).toBeNull();
    expect(await getItem('owner')).toBeNull();
  });

  it('signs out locally even when the server cannot be reached', async () => {
    await seedSession();
    await start();
    await screen.findByText(/^authenticated/);
    mockApi({ 'POST /api/auth/owner/logout': offline() });
    await act(() => current().signOut());
    expect(screen.getByText(/^anonymous/)).toBeTruthy();
  });

  it('does not call the server without a refresh token', async () => {
    await start();
    await act(() => current().signOut());
    expect(sent('POST /api/auth/owner/logout')).toHaveLength(0);
  });
});

describe('biometric lock', () => {
  it('unlocks only after a successful face or fingerprint check', async () => {
    await seedSession();
    await setItem('biometrics', '1');
    await start();
    await screen.findByText(/ locked /);
    localAuth.authenticateAsync.mockResolvedValueOnce({ success: false });
    await act(async () => {
      expect(await current().unlock()).toBe(false);
    });
    expect(screen.getByText(/ locked /)).toBeTruthy();
    await act(async () => {
      expect(await current().unlock()).toBe(true);
    });
    expect(screen.getByText(/ open /)).toBeTruthy();
  });

  it('turns the lock on only after the owner proves it works, and off without a check', async () => {
    await start();
    await screen.findByText(/^anonymous/);
    localAuth.authenticateAsync.mockResolvedValueOnce({ success: false });
    await act(() => current().setBiometrics(true));
    expect(screen.getByText(/bio-off/)).toBeTruthy();
    expect(await getItem('biometrics')).toBeNull();
    await act(() => current().setBiometrics(true));
    expect(screen.getByText(/bio-on/)).toBeTruthy();
    expect(await getItem('biometrics')).toBe('1');
    localAuth.authenticateAsync.mockClear();
    await act(() => current().setBiometrics(false));
    expect(localAuth.authenticateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/bio-off/)).toBeTruthy();
  });

  it('locks again after more than 5 minutes in the background', async () => {
    const listeners: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
    const now = jest.spyOn(Date, 'now');
    await seedSession();
    await setItem('biometrics', '1');
    await start();
    await screen.findByText(/ locked /);
    await act(() => current().unlock());
    const emit = (s: AppStateStatus) => {
      for (const l of listeners) l(s);
    };

    now.mockReturnValue(1_000_000);
    await act(() => {
      emit('background');
    });
    now.mockReturnValue(1_000_000 + 60_000);
    await act(() => {
      emit('active');
    });
    expect(screen.getByText(/ open /)).toBeTruthy();

    await act(() => {
      emit('inactive');
    });
    now.mockReturnValue(1_060_000 + 5 * 60_000 + 1);
    await act(() => {
      emit('active');
    });
    expect(screen.getByText(/ locked /)).toBeTruthy();
  });

  it('never locks when the lock is off', async () => {
    const listeners: ((s: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    });
    const now = jest.spyOn(Date, 'now');
    await seedSession();
    await start();
    await screen.findByText(/^authenticated/);
    now.mockReturnValue(0);
    await act(() => {
      for (const l of listeners) l('background');
    });
    now.mockReturnValue(60 * 60_000);
    await act(() => {
      for (const l of listeners) l('active');
    });
    expect(screen.getByText(/ open /)).toBeTruthy();
  });
});

it('refuses to be used outside the provider', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await expect(renderHook(() => useAuth())).rejects.toThrow('useAuth outside AuthProvider');
});
