import type { Page } from '@playwright/test';
import { createHmac } from 'node:crypto';

export const STAFF = {
  admin: { email: 'admin@vamar.test', password: 'Vamar2026!' },
  entry: { email: 'entry@vamar.test', password: 'Vamar2026!' },
} as const;

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from a base32 secret; no dependency needed in e2e. */
function codeFromSecret(secretBase32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.replace(/[^A-Z2-7]/gi, '').toUpperCase();
  let bits = '';
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = new Uint8Array((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = new Uint8Array(createHmac('sha1', key).update(counter).digest());
  const offset = (h[h.length - 1] ?? 0) & 0x0f;
  const value = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(offset) & 0x7fffffff;
  return (value % 1_000_000).toString().padStart(6, '0');
}

/**
 * Sign in through the real UI: Firebase emulator password, then TOTP. On first run the
 * authenticator is enrolled from the secret shown on screen and remembered in TOTP_SECRETS.
 */
export async function login(page: Page, who: keyof typeof STAFF, lang: 'ar' | 'en' = 'ar') {
  await page.addInitScript((l) => {
    localStorage.setItem('vamar.lang', l);
  }, lang);
  await page.goto('/login');
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(STAFF[who].email);
  await page.getByLabel(/كلمة المرور|Password/).fill(STAFF[who].password);
  await page.getByRole('button', { name: /تسجيل الدخول|Sign in/ }).click();

  // Either the enrollment screen (shows a secret) or the verify screen.
  const secretEl = page.locator('code[dir="ltr"]');
  const codeInput = page.getByLabel(/الرمز|Code/).first();
  await Promise.race([
    secretEl.waitFor({ timeout: 15_000 }),
    codeInput.waitFor({ timeout: 15_000 }),
  ]);
  let secret = process.env[`TOTP_SECRET_${who.toUpperCase()}`];
  const enrolling = await page
    .getByRole('heading', { name: /إعداد تطبيق المصادقة|Set up your authenticator/ })
    .isVisible();
  if (enrolling) await secretEl.waitFor({ timeout: 15_000 });
  if (enrolling && (await secretEl.isVisible())) {
    secret = (await secretEl.textContent())?.replace(/\s/g, '') ?? '';
    process.env[`TOTP_SECRET_${who.toUpperCase()}`] = secret;
  }
  if (!secret)
    throw new Error(
      `No TOTP secret for ${who}; reset the authenticator for this user and run again`,
    );
  await codeInput.fill(codeFromSecret(secret));
  await page.getByRole('button', { name: /تحقق|Verify/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}
