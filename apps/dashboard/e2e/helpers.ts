import type { Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetLoginCounters } from './db';

// Secrets enrolled during a run are kept in a gitignored file so a replacement worker (Playwright
// starts a new one after a failure) can still sign in without re-enrolling.
const SECRETS_FILE = join(dirname(fileURLToPath(import.meta.url)), '.totp-secrets.json');
const STEPS_FILE = join(dirname(fileURLToPath(import.meta.url)), '.totp-steps.json');
const TOTP_PERIOD_MS = 30_000;
function readJson(file: string): Record<string, string | number> {
  try {
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string | number>)
      : {};
  } catch {
    return {};
  }
}
function readSecrets(): Record<string, string> {
  return readJson(SECRETS_FILE) as Record<string, string>;
}
function saveSecret(who: string, secret: string) {
  const all = { ...readSecrets(), [who]: secret };
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  writeFileSync(SECRETS_FILE, JSON.stringify(all));
}
/**
 * The API accepts each TOTP code once. Tests sign the same user in several times a minute, so the
 * step of the last code used is remembered and the next sign-in waits for a fresh step.
 */
async function nextUnusedStep(who: string): Promise<void> {
  const used = Number(readJson(STEPS_FILE)[who] ?? -1);
  const step = Math.floor(Date.now() / TOTP_PERIOD_MS);
  if (step <= used) {
    const wait = (used + 1) * TOTP_PERIOD_MS - Date.now() + 500;
    await new Promise((r) => setTimeout(r, wait));
  }
  const all = { ...readJson(STEPS_FILE), [who]: Math.floor(Date.now() / TOTP_PERIOD_MS) };
  writeFileSync(STEPS_FILE, JSON.stringify(all));
}

/**
 * Password of the demo staff accounts in the local Auth emulator (dev and CI only). It is not the
 * password of any deployed account; override with LOCAL_STAFF_PASSWORD.
 */
export const LOCAL_STAFF_PASSWORD = process.env['LOCAL_STAFF_PASSWORD'] ?? 'local-emulator-only';

export const STAFF = {
  admin: { email: 'admin@vamar.test', password: LOCAL_STAFF_PASSWORD },
  entry: { email: 'entry@vamar.test', password: LOCAL_STAFF_PASSWORD },
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
  await resetLoginCounters(STAFF[who].email);
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
  let secret = process.env[`TOTP_SECRET_${who.toUpperCase()}`] ?? readSecrets()[who];
  const enrolling = await page
    .getByRole('heading', { name: /إعداد تطبيق المصادقة|Set up your authenticator/ })
    .isVisible();
  if (enrolling) await secretEl.waitFor({ timeout: 15_000 });
  if (enrolling && (await secretEl.isVisible())) {
    secret = (await secretEl.textContent())?.replace(/\s/g, '') ?? '';
    process.env[`TOTP_SECRET_${who.toUpperCase()}`] = secret;
    saveSecret(who, secret);
  }
  if (!secret)
    throw new Error(
      `No TOTP secret for ${who}; reset the authenticator for this user and run again`,
    );
  await nextUnusedStep(who);
  await codeInput.fill(codeFromSecret(secret));
  await page.getByRole('button', { name: /تحقق|Verify/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}
