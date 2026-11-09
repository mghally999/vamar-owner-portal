// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firebaseEmailLogin, firebaseSendVerificationEmail } from '@/lib/firebase';
import { apiError } from '@/test/api';
import { overview, staffUser } from '@/test/fixtures';
import { reportSummary, v2Routes } from '@/test/fixtures-v2';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,UVI=')) },
}));

beforeEach(() => {
  vi.mocked(firebaseEmailLogin).mockResolvedValue('firebase-id-token');
  vi.mocked(firebaseSendVerificationEmail).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const PRE_MFA = { preAuthToken: 'pre-1', totpEnrolled: true, name: 'Omar Saeed', role: 'editor' };
const SIGNED_IN = { accessToken: 'access-2', user: staffUser('editor') };

async function signIn(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await user.type(await screen.findByLabelText(/^Email/), ' omar@vamar.ae ');
  await user.type(screen.getByLabelText(/^Password/), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('signs in with password and authenticator code, then opens the overview', async () => {
    const { api, router, user } = await renderApp('/login', {
      role: null,
      // The overview behind the sign-in also loads the period summary, settings and holidays.
      routes: v2Routes({
        'POST /api/auth/staff/exchange': PRE_MFA,
        'POST /api/auth/staff/totp/verify': SIGNED_IN,
        'GET /api/staff/overview': overview(),
        'GET /api/staff/reports/summary': reportSummary(),
      }),
    });
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeTruthy();
    await signIn(user);
    expect(firebaseEmailLogin).toHaveBeenCalledWith('omar@vamar.ae', 'correct horse');
    expect(api.last('POST', '/api/auth/staff/exchange').body).toEqual({
      firebaseIdToken: 'firebase-id-token',
    });

    const code = await screen.findByLabelText(/^Code/);
    const verify = screen.getByRole('button', { name: 'Verify' });
    await user.type(code, '12a34');
    expect(code).toHaveProperty('value', '1234');
    expect(verify).toHaveProperty('disabled', true);
    await user.type(code, '56');
    await user.click(verify);

    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(await screen.findByText('Omar Saeed')).toBeTruthy();
    const call = api.last('POST', '/api/auth/staff/totp/verify');
    expect(call.body).toEqual({ code: '123456' });
    expect(call.headers.get('authorization')).toBe('Bearer pre-1');
    expect(localStorage.getItem('vamar_staff_session')).toBe('1');
    // Later requests carry the session's access token (once the lazy overview page has loaded).
    expect(await screen.findByText('Expected rent')).toBeTruthy();
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/overview').headers.get('authorization')).toBe(
        'Bearer access-2',
      );
    });
  });

  it('enrols a new authenticator with a QR code and the typed key', async () => {
    const { api, user } = await renderApp('/login', {
      role: null,
      routes: {
        'POST /api/auth/staff/exchange': { ...PRE_MFA, totpEnrolled: false },
        'POST /api/auth/staff/totp/setup': {
          otpauthUri: 'otpauth://totp/Vamar:omar@vamar.ae?secret=JBSWY3DPEHPK3PXP',
          secret: 'JBSWY3DPEHPK3PXP',
        },
      },
    });
    await signIn(user);
    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeTruthy();
    expect((await screen.findByRole('img', { name: 'QR' })).getAttribute('src')).toBe(
      'data:image/png;base64,UVI=',
    );
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(api.to('POST', '/api/auth/staff/totp/setup')).toHaveLength(1);
  });

  it('shows an error when the authenticator setup fails', async () => {
    const { user } = await renderApp('/login', {
      role: null,
      routes: {
        'POST /api/auth/staff/exchange': { ...PRE_MFA, totpEnrolled: false },
        'POST /api/auth/staff/totp/setup': apiError(500, 'internal'),
      },
    });
    await signIn(user);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('explains a wrong code, a lock-out, and goes back to the password step', async () => {
    let locked = false;
    const { api, user } = await renderApp('/login', {
      role: null,
      routes: {
        'POST /api/auth/staff/exchange': PRE_MFA,
        'POST /api/auth/staff/totp/verify': () =>
          locked ? apiError(429, 'totp_locked') : apiError(401, 'totp_invalid'),
        'POST /api/auth/staff/logout': { ok: true },
      },
    });
    await signIn(user);
    const code = await screen.findByLabelText(/^Code/);
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Wrong code\./);
    expect(code).toHaveProperty('value', '');

    locked = true;
    await user.type(code, '111111{Enter}');
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Too many wrong codes. Try again in 15 minutes.',
      );
    });
    // A refused code on an auth route never triggers a session refresh.
    expect(api.to('POST', '/api/auth/staff/refresh')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeTruthy();
    expect(api.to('POST', '/api/auth/staff/logout')).toHaveLength(1);
  });

  it('signs straight in when 2-step login is off for the account', async () => {
    const { router, user } = await renderApp('/login', {
      role: null,
      routes: {
        'POST /api/auth/staff/exchange': SIGNED_IN,
        'GET /api/staff/overview': overview(),
      },
    });
    await signIn(user);
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(await screen.findByText('Omar Saeed')).toBeTruthy();
  });

  it.each([
    [apiError(403, 'not_staff'), 'This email is not a Vamar staff account.'],
    [apiError(429, 'rate_limited'), 'Too many sign-in attempts. Wait a few minutes and try again.'],
    [apiError(500, 'internal'), 'Wrong email or password.'],
  ])('explains a refused exchange (%#)', async (answer, message) => {
    const { user } = await renderApp('/login', {
      role: null,
      routes: { 'POST /api/auth/staff/exchange': answer },
    });
    await signIn(user);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(firebaseSendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends the verification e-mail when the address is not confirmed', async () => {
    const { user } = await renderApp('/login', {
      role: null,
      routes: { 'POST /api/auth/staff/exchange': apiError(403, 'email_unverified') },
    });
    await signIn(user);
    expect((await screen.findByRole('alert')).textContent).toMatch(/not confirmed yet/);
    expect(firebaseSendVerificationEmail).toHaveBeenCalledWith('omar@vamar.ae', 'correct horse');
  });

  it('reports wrong Firebase credentials without calling the API', async () => {
    vi.mocked(firebaseEmailLogin).mockRejectedValue(new Error('auth/invalid-credential'));
    const { api, user } = await renderApp('/login', { role: null });
    await signIn(user);
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong email or password.');
    expect(api.to('POST', '/api/auth/staff/exchange')).toHaveLength(0);
  });

  it('says why the session ended and switches language', async () => {
    window.history.replaceState(null, '', '/login?reason=expired');
    const { user } = await renderApp('/login', { role: null });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your session expired or was signed out. Please sign in again.',
    );
    await user.click(screen.getByRole('button', { name: 'العربية' }));
    expect(await screen.findByRole('heading', { name: 'دخول الموظفين' })).toBeTruthy();
    expect(localStorage.getItem('vamar.lang')).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('sends a visitor without a session from a page to the sign-in form', async () => {
    const { router } = await renderApp('/login', { role: null });
    await screen.findByRole('heading', { name: 'Staff sign-in' });
    await router.navigate({ to: '/owners' });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
  });

  it('moves a signed-in user on to the overview', async () => {
    const { router } = await renderApp('/login', {
      routes: { 'GET /api/staff/overview': overview() },
    });
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });
});
