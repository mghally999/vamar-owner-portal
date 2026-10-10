import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import {
  ApiRequestError,
  request,
  setAccessToken,
  setSessionLostHandler,
  refreshSession,
} from './api';
import { confirmCode, startPhoneSignIn, type Confirmation } from './firebase';
import { registerForPush } from './push';
import { deviceId, getItem, setItem } from './storage';
import type { OwnerProfile } from './types';

export type AuthStage = 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  stage: AuthStage;
  owner: Pick<OwnerProfile, 'id' | 'nameAr' | 'nameEn' | 'preferredLang'> | null;
  /** Face ID / fingerprint gate. */
  locked: boolean;
  biometricsEnabled: boolean;
  biometricsAvailable: boolean;
  /** Set once after the first successful sign-in so we can offer the biometric opt-in. */
  justSignedIn: boolean;
  sendCode: (phoneE164: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: () => Promise<boolean>;
  setBiometrics: (on: boolean) => Promise<void>;
  clearJustSignedIn: () => void;
}

const Ctx = createContext<AuthState | null>(null);
const LOCK_AFTER_MS = 5 * 60 * 1000;

export class NotRegisteredError extends Error {}
export class AccountDisabledError extends Error {}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [owner, setOwner] = useState<AuthState['owner']>(null);
  const [locked, setLocked] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const confirmation = useRef<Confirmation | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  // Resume the session from the stored refresh token.
  useEffect(() => {
    // Never let a native call keep the splash screen up: anything slower than 4 s or failing is
    // treated as "no session" and the user simply signs in again.
    const withTimeout = <T,>(p: Promise<T>, fallback: T) =>
      Promise.race([p, new Promise<T>((r) =>
          setTimeout(() => {
            r(fallback);
          }, 4000),
        )]).catch(
        () => fallback,
      );
    void (async () => {
      try {
        const [bio, savedOwner, hasHw] = await Promise.all([
          withTimeout(getItem('biometrics'), null),
          withTimeout(getItem('owner'), null),
          withTimeout(LocalAuthentication.hasHardwareAsync(), false),
        ]);
        const enrolled = hasHw
          ? await withTimeout(LocalAuthentication.isEnrolledAsync(), false)
          : false;
        setBiometricsAvailable(hasHw && enrolled);
        setBiometricsEnabled(bio === '1');
        const token = await withTimeout(refreshSession(), null);
        if (token) {
          if (savedOwner) setOwner(JSON.parse(savedOwner) as AuthState['owner']);
          setStage('authenticated');
          setLocked(bio === '1');
          void registerForPush();
        } else setStage('anonymous');
      } catch (e) {
        if (__DEV__) console.warn('[auth] bootstrap failed', e);
        setStage('anonymous');
      }
    })();
    setSessionLostHandler(() => {
      setAccessToken(null);
      setStage('anonymous');
      setOwner(null);
    });
  }, []);

  // Lock after 5 minutes in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') backgroundedAt.current = Date.now();
      else if (
        state === 'active' &&
        biometricsEnabled &&
        backgroundedAt.current &&
        Date.now() - backgroundedAt.current > LOCK_AFTER_MS
      ) {
        setLocked(true);
      }
    });
    return () => {
      sub.remove();
    };
  }, [biometricsEnabled]);

  const sendCode = useCallback(async (phoneE164: string) => {
    confirmation.current = await startPhoneSignIn(phoneE164);
  }, []);

  const verifyCode = useCallback(async (code: string) => {
    if (!confirmation.current) throw new Error('No pending verification');
    const idToken = await confirmCode(confirmation.current, code);
    try {
      const res = await request<{
        accessToken: string;
        refreshToken: string;
        owner: NonNullable<AuthState['owner']>;
      }>('/api/auth/owner/exchange', {
        method: 'POST',
        body: JSON.stringify({
          firebaseIdToken: idToken,
          device: {
            deviceId: await deviceId(),
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            model: Device.modelName ?? '',
            pushToken: null,
          },
        }),
      });
      setAccessToken(res.accessToken);
      await setItem('refreshToken', res.refreshToken);
      await setItem('owner', JSON.stringify(res.owner));
      setOwner(res.owner);
      setJustSignedIn(true);
      setStage('authenticated');
      void registerForPush();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'owner_not_registered')
        throw new NotRegisteredError(e.message);
      if (e instanceof ApiRequestError && e.code === 'owner_disabled')
        throw new AccountDisabledError(e.message);
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = await getItem('refreshToken');
    if (refreshToken) {
      try {
        await request('/api/auth/owner/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // best effort
      }
    }
    setAccessToken(null);
    await setItem('refreshToken', null);
    await setItem('owner', null);
    setOwner(null);
    setStage('anonymous');
    setLocked(false);
  }, []);

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Vamar',
      fallbackLabel: '',
      disableDeviceFallback: false,
      cancelLabel: ' ',
    });
    if (r.success) setLocked(false);
    return r.success;
  }, []);

  const setBiometrics = useCallback(async (on: boolean) => {
    if (on) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Vamar' });
      if (!r.success) return;
    }
    await setItem('biometrics', on ? '1' : null);
    setBiometricsEnabled(on);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      stage,
      owner,
      locked,
      biometricsEnabled,
      biometricsAvailable,
      justSignedIn,
      sendCode,
      verifyCode,
      signOut,
      unlock,
      setBiometrics,
      clearJustSignedIn: () => {
        setJustSignedIn(false);
      },
    }),
    [
      stage,
      owner,
      locked,
      biometricsEnabled,
      biometricsAvailable,
      justSignedIn,
      sendCode,
      verifyCode,
      signOut,
      unlock,
      setBiometrics,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
