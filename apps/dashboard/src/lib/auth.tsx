import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isActive, onActivityChange } from './activity';
import {
  accessTokenAge,
  ApiRequestError,
  getCachedUser,
  hasSessionFlag,
  refreshStaffSession,
  request,
  setAccessToken,
  setCachedUser,
  setSessionFlag,
  setSessionLostHandler,
  type StaffUser,
} from './api';

export type AuthStage = 'loading' | 'anonymous' | 'pre-mfa' | 'authenticated';

export interface AuthState {
  stage: AuthStage;
  user: StaffUser | null;
  /** Pre-MFA: whether the authenticator was already enrolled. */
  totpEnrolled: boolean;
  login: (email: string, password: string) => Promise<void>;
  totpSetup: () => Promise<{ otpauthUri: string; secret: string }>;
  totpVerify: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (min: 'viewer' | 'editor' | 'admin') => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Firebase Auth (about 24 kB gzip) is needed only when a password is submitted, so it loads then
 * instead of with the app and a signed-in visit never downloads it. The login form calls this
 * when it appears, so the submit does not wait for the download.
 */
export function loadFirebase() {
  return import('./firebase');
}

const RANK = { viewer: 0, editor: 1, admin: 2 } as const;
/** Access tokens live 15 minutes; refresh with a margin. */
const ACCESS_TOKEN_MINUTES = 15;
const REFRESH_EVERY_MS = (ACCESS_TOKEN_MINUTES - 3) * 60_000;
/** How often the age of the token is checked (no request unless it is due). */
const CHECK_EVERY_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [user, setUser] = useState<StaffUser | null>(null);
  const [totpEnrolled, setTotpEnrolled] = useState(false);
  const [preToken, setPreToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Resume the session from the httpOnly cookie on load, when one may exist.
  useEffect(() => {
    if (!hasSessionFlag()) setStage('anonymous');
    else {
      void refreshStaffSession().then((r) => {
        if (r.ok) {
          setUser(getCachedUser());
          setStage('authenticated');
        } else setStage('anonymous');
      });
    }
    setSessionLostHandler(() => {
      setAccessToken(null);
      setCachedUser(null);
      setSessionFlag(false);
      setUser(null);
      setStage('anonymous');
      queryClient.clear();
      // Route guards only run on navigation, so send the browser to the login page explicitly.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?reason=expired');
      }
    });
  }, [queryClient]);

  // Refresh the access token before it expires, but only while someone is using the tab: a
  // hidden or idle tab no longer wakes the database every 12 minutes. Coming back refreshes a
  // token that has gone stale before the page asks for anything (a request that still meets an
  // expired token refreshes on its own). A server hiccup is retried on the next check; only a
  // refusal ends the session.
  useEffect(() => {
    if (stage !== 'authenticated') return;
    const refreshIfDue = () => {
      if (!isActive() || accessTokenAge() < REFRESH_EVERY_MS) return;
      void refreshStaffSession().then((r) => {
        if (!r.ok && r.reason === 'unauthenticated') {
          setAccessToken(null);
          setCachedUser(null);
          setUser(null);
          setStage('anonymous');
          queryClient.clear();
          window.location.assign('/login?reason=expired');
        }
      });
    };
    const id = window.setInterval(refreshIfDue, CHECK_EVERY_MS);
    const unsubscribe = onActivityChange(refreshIfDue);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [stage, queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const { firebaseEmailLogin, firebaseSendVerificationEmail } = await loadFirebase();
    const idToken = await firebaseEmailLogin(email, password);
    let res:
      | { preAuthToken: string; totpEnrolled: boolean; name: string; role: StaffUser['role'] }
      | { accessToken: string; user: StaffUser };
    try {
      res = await request('/api/auth/staff/exchange', {
        method: 'POST',
        body: JSON.stringify({ firebaseIdToken: idToken }),
      });
    } catch (err) {
      // First sign-in of an invited account: Firebase must confirm the address first.
      if (err instanceof ApiRequestError && err.code === 'email_unverified') {
        await firebaseSendVerificationEmail(email, password);
      }
      throw err;
    }
    if ('accessToken' in res) {
      // 2-step login switched off for this account (demo accounts during the trial).
      setAccessToken(res.accessToken);
      setCachedUser(res.user);
      setSessionFlag(true);
      setUser(res.user);
      setPreToken(null);
      setStage('authenticated');
      return;
    }
    setPreToken(res.preAuthToken);
    setAccessToken(res.preAuthToken);
    setTotpEnrolled(res.totpEnrolled);
    setStage('pre-mfa');
  }, []);

  const totpSetup = useCallback(async () => {
    return request<{ otpauthUri: string; secret: string }>('/api/auth/staff/totp/setup', {
      method: 'POST',
    });
  }, []);

  const totpVerify = useCallback(
    async (code: string) => {
      if (!preToken) throw new Error('Sign in first');
      const res = await request<{ accessToken: string; user: StaffUser }>(
        '/api/auth/staff/totp/verify',
        {
          method: 'POST',
          body: JSON.stringify({ code }),
        },
      );
      setAccessToken(res.accessToken);
      setCachedUser(res.user);
      setSessionFlag(true);
      setUser(res.user);
      setPreToken(null);
      setStage('authenticated');
    },
    [preToken],
  );

  const logout = useCallback(async () => {
    try {
      await request('/api/auth/staff/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAccessToken(null);
    setCachedUser(null);
    setSessionFlag(false);
    setUser(null);
    setStage('anonymous');
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      stage,
      user,
      totpEnrolled,
      login,
      totpSetup,
      totpVerify,
      logout,
      hasRole: (min) => (user ? RANK[user.role] >= RANK[min] : false),
    }),
    [stage, user, totpEnrolled, login, totpSetup, totpVerify, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
