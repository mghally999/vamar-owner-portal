/** Small WebCrypto helpers. Nothing here hashes passwords (Firebase does that). */

const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return hex(new Uint8Array(digest));
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secretB64: string): Promise<CryptoKey> {
  let raw = fromBase64(secretB64);
  if (raw.length !== 32) {
    // Derive a 256-bit key from whatever was configured so misconfiguration fails loudly only in length.
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM. Output: base64url(iv) + '.' + base64url(ciphertext). */
export async function encryptString(plain: string, secretB64: string): Promise<string> {
  const key = await aesKey(secretB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return `${base64url(iv)}.${base64url(new Uint8Array(ct))}`;
}

export async function decryptString(payload: string, secretB64: string): Promise<string> {
  const [ivB64, ctB64] = payload.split('.');
  if (!ivB64 || !ctB64) throw new Error('bad ciphertext');
  const key = await aesKey(secretB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) },
    key,
    fromBase64(ctB64),
  );
  return new TextDecoder().decode(pt);
}

/** Constant-time string compare for short secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
