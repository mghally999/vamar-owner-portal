/**
 * Verifies Firebase ID tokens. Production: RS256 against Google's securetoken JWKS (cached by
 * jose), `iss` and `aud` pinned to our project. Development: when FIREBASE_AUTH_EMULATOR_HOST is
 * set the emulator issues unsigned tokens (alg "none"), so we decode and check the claims only.
 */
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { unauthorized } from '../errors.js';
import type { Bindings } from '../env.js';

const JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export interface FirebaseIdentity {
  uid: string;
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
}

interface FirebaseClaims extends JWTPayload {
  phone_number?: string;
  email?: string;
  email_verified?: boolean;
  user_id?: string;
}

export async function verifyFirebaseIdToken(
  env: Bindings,
  token: string,
): Promise<FirebaseIdentity> {
  const issuer = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
  let claims: FirebaseClaims;

  if (env.FIREBASE_AUTH_EMULATOR_HOST) {
    try {
      claims = decodeJwt<FirebaseClaims>(token);
    } catch {
      throw unauthorized('Invalid Firebase token');
    }
    if (claims.iss !== issuer || claims.aud !== env.FIREBASE_PROJECT_ID) {
      throw unauthorized('Firebase token is for another project');
    }
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
      throw unauthorized('Firebase token expired');
    }
  } else {
    jwks ??= createRemoteJWKSet(JWKS_URL, { cacheMaxAge: 6 * 60 * 60 * 1000 });
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: env.FIREBASE_PROJECT_ID,
        algorithms: ['RS256'],
      });
      claims = payload;
    } catch {
      throw unauthorized('Invalid Firebase token');
    }
  }

  const uid = claims.sub ?? claims.user_id;
  if (!uid) throw unauthorized('Firebase token has no subject');
  return {
    uid,
    phone: claims.phone_number ?? null,
    email: claims.email ?? null,
    emailVerified: claims.email_verified === true,
  };
}
