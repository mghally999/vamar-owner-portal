# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: screenshots.spec.ts >> screenshots ar @1440
- Location: e2e\screenshots.spec.ts:22:5

# Error details

```
TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('code[dir="ltr"]') to be visible

```

# Page snapshot

```yaml
- generic [ref=f2e4]:
  - generic [ref=f2e5]:
    - img "Vamar Real Estate" [ref=f2e6]
    - paragraph [ref=f2e7]: بوابة ملاك فامار للعقارات
  - generic [ref=f2e9]:
    - heading "دخول الموظفين" [level=1] [ref=f2e10]
    - generic [ref=f2e11]:
      - generic [ref=f2e12]: البريد الإلكتروني
      - textbox "البريد الإلكتروني" [ref=f2e14]: admin@vamar.test
    - generic [ref=f2e15]:
      - generic [ref=f2e16]: كلمة المرور
      - textbox "كلمة المرور" [ref=f2e18]: Vamar2026!
    - alert [ref=f2e19]: البريد الإلكتروني أو كلمة المرور غير صحيحة.
    - button "تسجيل الدخول" [ref=f2e20]
  - button "English" [ref=f2e21]
```

# Test source

```ts
  1  | import type { Page } from '@playwright/test';
  2  | import { createHmac } from 'node:crypto';
  3  | 
  4  | export const STAFF = {
  5  |   admin: { email: 'admin@vamar.test', password: 'Vamar2026!' },
  6  |   entry: { email: 'entry@vamar.test', password: 'Vamar2026!' },
  7  | } as const;
  8  | 
  9  | /** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from a base32 secret; no dependency needed in e2e. */
  10 | function codeFromSecret(secretBase32: string): string {
  11 |   const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  12 |   const clean = secretBase32.replace(/[^A-Z2-7]/gi, '').toUpperCase();
  13 |   let bits = '';
  14 |   for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  15 |   const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  16 |   const counter = Buffer.alloc(8);
  17 |   counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  18 |   const h = createHmac('sha1', key).update(counter).digest();
  19 |   const offset = (h[h.length - 1] ?? 0) & 0x0f;
  20 |   const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  21 |   return code;
  22 | }
  23 | 
  24 | /**
  25 |  * Sign in through the real UI: Firebase emulator password, then TOTP. On first run the
  26 |  * authenticator is enrolled from the secret shown on screen and remembered in TOTP_SECRETS.
  27 |  */
  28 | export async function login(page: Page, who: keyof typeof STAFF, lang: 'ar' | 'en' = 'ar') {
  29 |   await page.addInitScript((l) => {
  30 |     localStorage.setItem('vamar.lang', l);
  31 |   }, lang);
  32 |   await page.goto('/login');
  33 |   await page.getByLabel(/البريد الإلكتروني|Email/).fill(STAFF[who].email);
  34 |   await page.getByLabel(/كلمة المرور|Password/).fill(STAFF[who].password);
  35 |   await page.getByRole('button', { name: /تسجيل الدخول|Sign in/ }).click();
  36 | 
  37 |   // Either the enrollment screen (shows a secret) or the verify screen.
  38 |   const secretEl = page.locator('code[dir="ltr"]');
  39 |   const codeInput = page.getByLabel(/الرمز|Code/).first();
> 40 |   await Promise.race([secretEl.waitFor({ timeout: 15_000 }), codeInput.waitFor({ timeout: 15_000 })]);
     |                                ^ TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
  41 |   let secret = process.env[`TOTP_SECRET_${who.toUpperCase()}`];
  42 |   if (await secretEl.isVisible()) {
  43 |     secret = (await secretEl.textContent())?.replace(/\s/g, '') ?? '';
  44 |     process.env[`TOTP_SECRET_${who.toUpperCase()}`] = secret;
  45 |   }
  46 |   if (!secret) throw new Error(`No TOTP secret for ${who}; reset the authenticator for this user and run again`);
  47 |   await codeInput.fill(codeFromSecret(secret));
  48 |   await page.getByRole('button', { name: /تحقق|Verify/ }).click();
  49 |   await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
  50 | }
  51 | 
```