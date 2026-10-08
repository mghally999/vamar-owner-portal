import { getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';

/**
 * Firebase is used only to verify the staff member's email + password; the ID token is then
 * exchanged for our own session. Config comes from Vite env vars (public by design).
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'demo-vamar.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'demo-vamar',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app',
};

const app = getApps()[0] ?? initializeApp(config);
export const firebaseAuth = getAuth(app);

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
