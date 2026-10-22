/// <reference lib="dom" />
/**
 * Firebase phone sign-in for the owner web app (/app). Same contract as firebase.ts (native), but
 * through the Firebase JS SDK with an invisible reCAPTCHA, which Firebase requires on the web.
 * The page's host must be in Firebase > Authentication > Settings > Authorised domains.
 */
import { getApps, initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth';

const app =
  getApps()[0] ??
  initializeApp({
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  });
const auth = initializeAuth(app, { persistence: browserSessionPersistence });

const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
}

export type Confirmation = ConfirmationResult;

let verifier: RecaptchaVerifier | null = null;

function invisibleVerifier(): RecaptchaVerifier {
  if (!verifier) {
    const el = document.createElement('div');
    el.id = 'vamar-recaptcha';
    document.body.appendChild(el);
    verifier = new RecaptchaVerifier(auth, el, { size: 'invisible' });
  }
  return verifier;
}

export async function startPhoneSignIn(phoneE164: string): Promise<Confirmation> {
  try {
    return await signInWithPhoneNumber(auth, phoneE164, invisibleVerifier());
  } catch (e) {
    // A used or expired challenge cannot be reused; the next attempt gets a fresh one.
    verifier?.clear();
    verifier = null;
    throw e;
  }
}

/** Confirm the SMS code and return a fresh Firebase ID token; the Firebase session is discarded. */
export async function confirmCode(confirmation: Confirmation, code: string): Promise<string> {
  const cred = await confirmation.confirm(code);
  const token = await cred.user.getIdToken(true);
  await signOut(auth);
  return token;
}
