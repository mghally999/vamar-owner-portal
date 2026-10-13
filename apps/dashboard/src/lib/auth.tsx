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
import { firebaseEmailLogin } from './firebase';
import {
  getCachedUser,
  refreshStaffSession,
  request,
  setAccessToken,
  setCachedUser,
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
const RANK = { viewer: 0, editor: 1, admin: 2 } as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [user, setUser] = useState<StaffUser | null>(null);
  const [totpEnrolled, setTotpEnrolled] = useState(false);
  const [preToken, setPreToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Resume the session from the httpOnly cookie on load.
  useEffect(() => {
    void refreshStaffSession().then((token) => {
      if (token) {
        setUser(getCachedUser());
        setStage('authenticated');
      } else setStage('anonymous');
    });
    setSessionLostHandler(() => {
      setAccessToken(null);
      setCachedUser(null);
      setUser(null);
      setStage('anonymous');
      queryClient.clear();
      // Route guards only run on navigation, so send the browser to the login page explicitly.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    });
  }, [queryClient]);

  // Refresh the access token every 12 minutes while signed in (tokens live 15).
  useEffect(() => {
    if (stage !== 'authenticated') return;
    const id = window.setInterval(() => {
      void refreshStaffSession().then((token) => {
        if (!token) {
          setAccessToken(null);
          setCachedUser(null);
          setUser(null);
          setStage('anonymous');
          queryClient.clear();
          window.location.assign('/login');
        }
      });
    }, 12 * 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, [stage, queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const idToken = await firebaseEmailLogin(email, password);
    const res = await request<{
      preAuthToken: string;
      totpEnrolled: boolean;
      name: string;
      role: StaffUser['role'];
    }>('/api/auth/staff/exchange', {
      method: 'POST',
      body: JSON.stringify({ firebaseIdToken: idToken }),
    });
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
