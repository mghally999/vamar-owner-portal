/**
 * Firebase Phone Auth through @react-native-firebase/auth (native). In development the app
 * talks to the Auth emulator; the verification code appears in the emulator UI / logs.
 */
import { getApp } from '@react-native-firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithPhoneNumber,
  signOut,
} from '@react-native-firebase/auth';

const auth = getAuth(getApp());

const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(auth, `http://${emulatorHost}`);
}

export type Confirmation = Awaited<ReturnType<typeof signInWithPhoneNumber>>;

export async function startPhoneSignIn(phoneE164: string): Promise<Confirmation> {
  return signInWithPhoneNumber(auth, phoneE164);
}

/** Confirm the SMS code and return a fresh Firebase ID token; the Firebase session is discarded. */
export async function confirmCode(confirmation: Confirmation, code: string): Promise<string> {
  const cred = await confirmation.confirm(code);
  const token = await cred.user.getIdToken(true);
  await signOut(auth);
  return token;
}
