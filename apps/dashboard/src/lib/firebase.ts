import { getApps, initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

/**
 * Firebase is used only to verify the staff member's email + password; the ID token is then
 * exchanged for our own session. Config comes from Vite env vars (public by design). A build
 * without them is a broken build, so it fails here instead of silently targeting a demo project.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set for this build`);
  return value;
}

const config = {
  apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
};

const app = getApps()[0] ?? initializeApp(config);
// No popup/redirect resolver: password sign-in needs none, and leaving it out keeps Firebase from
// loading Google's gapi script, which the CSP blocks anyway.
const firebaseAuth = initializeAuth(app, { persistence: browserSessionPersistence });

const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(firebaseAuth, `http://${emulatorHost}`, { disableWarnings: true });
}

/** Sign in with Firebase and return a fresh ID token; Firebase session is discarded right after. */
export async function firebaseEmailLogin(email: string, password: string): Promise<string> {
  const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
  const token = await cred.user.getIdToken();
  await signOut(firebaseAuth);
  return token;
}

/** Ask Firebase to e-mail the verification link to an account whose address is not confirmed. */
export async function firebaseSendVerificationEmail(
  email: string,
  password: string,
): Promise<void> {
  const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
  try {
    if (!cred.user.emailVerified) await sendEmailVerification(cred.user);
  } finally {
    await signOut(firebaseAuth);
  }
}
