import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type UserCredential,
} from 'firebase/auth';

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
}));
vi.mock('firebase/auth', () => ({
  browserSessionPersistence: { type: 'SESSION' },
  connectAuthEmulator: vi.fn(),
  initializeAuth: vi.fn(() => ({ name: 'auth' })),
  sendEmailVerification: vi.fn(() => Promise.resolve()),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
}));

const ENV = {
  VITE_FIREBASE_API_KEY: 'key-1',
  VITE_FIREBASE_AUTH_DOMAIN: 'vamar-demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'vamar-demo',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
};

function credential(emailVerified: boolean): UserCredential {
  return {
    user: { emailVerified, getIdToken: () => Promise.resolve('id-token-1') },
  } as unknown as UserCredential;
}

beforeEach(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubEnv('VITE_FIREBASE_AUTH_EMULATOR_HOST', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('firebase sign-in', () => {
  it('refuses to start without its build-time config', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
    await expect(import('./firebase')).rejects.toThrow(
      'VITE_FIREBASE_PROJECT_ID is not set for this build',
    );
  });

  it('uses the configured project and the emulator when one is set', async () => {
    vi.stubEnv('VITE_FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
    await import('./firebase');
    expect(initializeApp).toHaveBeenCalledWith({
      apiKey: 'key-1',
      authDomain: 'vamar-demo.firebaseapp.com',
      projectId: 'vamar-demo',
      appId: '1:123:web:abc',
    });
    expect(connectAuthEmulator).toHaveBeenCalledWith({ name: 'auth' }, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
  });

  it('returns an ID token and discards the Firebase session', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue(credential(true));
    const { firebaseEmailLogin } = await import('./firebase');
    await expect(firebaseEmailLogin('omar@vamar.ae', 'pw')).resolves.toBe('id-token-1');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      { name: 'auth' },
      'omar@vamar.ae',
      'pw',
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('sends the verification e-mail only to an unconfirmed address', async () => {
    const { firebaseSendVerificationEmail } = await import('./firebase');
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue(credential(false));
    await firebaseSendVerificationEmail('new@vamar.ae', 'pw');
    expect(sendEmailVerification).toHaveBeenCalledTimes(1);

    vi.mocked(signInWithEmailAndPassword).mockResolvedValue(credential(true));
    await firebaseSendVerificationEmail('omar@vamar.ae', 'pw');
    expect(sendEmailVerification).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it('signs out even when sending the e-mail fails', async () => {
    const { firebaseSendVerificationEmail } = await import('./firebase');
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue(credential(false));
    vi.mocked(sendEmailVerification).mockRejectedValueOnce(new Error('auth/too-many-requests'));
    await expect(firebaseSendVerificationEmail('new@vamar.ae', 'pw')).rejects.toThrow(
      'auth/too-many-requests',
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
