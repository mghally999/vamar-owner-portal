import { confirmCode, startPhoneSignIn, type Confirmation } from '@/lib/firebase';
import { confirmation, firebaseAuth, firebaseUser } from '@/test/native';

describe('Firebase phone sign-in', () => {
  it('sends the code to the number in E.164', async () => {
    await expect(startPhoneSignIn('+971501234567')).resolves.toBe(confirmation);
    expect(firebaseAuth.signInWithPhoneNumber).toHaveBeenCalledWith(
      { app: 'default' },
      '+971501234567',
    );
  });

  it('returns a fresh ID token for the right code and drops the Firebase session', async () => {
    await expect(confirmCode(confirmation as unknown as Confirmation, '123456')).resolves.toBe(
      'id-token',
    );
    expect(firebaseUser.getIdToken).toHaveBeenCalledWith(true);
    expect(firebaseAuth.signOut).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong code without signing anything out', async () => {
    await expect(confirmCode(confirmation as unknown as Confirmation, '000000')).rejects.toThrow(
      'invalid-verification-code',
    );
    expect(firebaseAuth.signOut).not.toHaveBeenCalled();
  });

  it('talks to the Auth emulator only when its host is configured', () => {
    expect(firebaseAuth.connectAuthEmulator).not.toHaveBeenCalled();
    const before = process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    try {
      jest.isolateModules(() => {
        require('@/lib/firebase');
        const auth = jest.requireMock<{ connectAuthEmulator: jest.Mock }>(
          '@react-native-firebase/auth',
        );
        expect(auth.connectAuthEmulator).toHaveBeenCalledWith(
          { app: 'default' },
          'http://localhost:9099',
        );
      });
    } finally {
      if (before === undefined) delete process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
      else process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST = before;
    }
  });
});
