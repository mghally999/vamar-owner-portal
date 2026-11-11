/**
 * Acts as an owner in the owner web app (/app, served by the API from apps/dashboard/dist/app).
 *
 * Owners sign in with an SMS code, which a test cannot receive: like tooling/dev/app-screenshots.mjs,
 * a device and a refresh session are written straight into the LOCAL database (db.ts refuses any
 * other) and put in the new browser context's localStorage before the app starts. The app then
 * refreshes that session the way it does on every launch. Devices made here carry the model
 * `e2e-journeys` so they never pile up in the owner's list of signed-in devices.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { withLocalDb } from './db';

/** Where the owner web app is served: the API origin (Vite only proxies /api to it). */
export const OWNER_APP_URL = (process.env['OWNER_APP_URL'] ?? 'http://127.0.0.1:8787/app').replace(
  /\/$/,
  '',
);

const DEVICE_MODEL = 'e2e-journeys';

export interface OwnerRow {
  id: string;
  nameAr: string;
  nameEn: string;
  preferredLang: string;
}

export async function ownerByPhone(phone: string): Promise<OwnerRow> {
  const owner = await withLocalDb(async (c) => {
    const r = await c.query<OwnerRow>(
      `select id, name_ar as "nameAr", name_en as "nameEn", preferred_lang as "preferredLang"
         from owners where phone_e164 = $1`,
      [phone],
    );
    return r.rows[0];
  });
  if (!owner) throw new Error(`no owner with phone ${phone} (seed the local database)`);
  return owner;
}

/** A fresh device and refresh token for the owner, valid for an hour. */
async function newSession(ownerId: string): Promise<{ deviceId: string; refreshToken: string }> {
  const deviceId = `web-e2e-${randomUUID()}`;
  // Hex: the e2e tsconfig has no Node Buffer typings for toString(encoding).
  const refreshToken = Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
  await withLocalDb(async (c) => {
    await c.query(
      `insert into devices (id, owner_id, device_id, platform, model) values ($1, $2, $3, 'web', $4)`,
      [randomUUID(), ownerId, deviceId, DEVICE_MODEL],
    );
    await c.query(
      `insert into sessions (id, subject_type, subject_id, device_id, token_hash, expires_at)
       values ($1, 'owner', $2, $3, $4, now() + interval '1 hour')`,
      [randomUUID(), ownerId, deviceId, createHash('sha256').update(refreshToken).digest('hex')],
    );
  });
  return { deviceId, refreshToken };
}

/** Removes the sessions and devices this helper made for the owner. */
export async function removeOwnerSessions(ownerId: string): Promise<void> {
  await withLocalDb(async (c) => {
    await c.query(
      `delete from sessions where device_id in
         (select device_id from devices where owner_id = $1 and model = $2)`,
      [ownerId, DEVICE_MODEL],
    );
    await c.query(`delete from devices where owner_id = $1 and model = $2`, [
      ownerId,
      DEVICE_MODEL,
    ]);
  });
}

export interface OwnerApp {
  context: BrowserContext;
  page: Page;
  owner: OwnerRow;
  /** Opens a screen of the web app, e.g. `/messages`, and waits for the signed-in screen. */
  open: (path: string) => Promise<void>;
  close: () => Promise<void>;
}

const SIGN_IN = /^(Sign in|تسجيل الدخول)$/;

/**
 * A browser context signed in as the owner with this phone, in the given language, on a phone
 * screen (the app is built for phones; the web build is the same screens).
 */
export async function ownerApp(
  browser: Browser,
  phone: string,
  lang: 'ar' | 'en',
): Promise<OwnerApp> {
  const owner = await ownerByPhone(phone);
  const session = await newSession(owner.id);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: true,
    locale: lang === 'ar' ? 'ar-AE' : 'en-AE',
    // The app's service worker would serve a cached shell between tests.
    serviceWorkers: 'block',
  });
  // Written once per tab: the app rotates the refresh token, and a reload must keep the new one.
  await context.addInitScript(
    (v) => {
      if (sessionStorage.getItem('e2e-owner-init')) return;
      sessionStorage.setItem('e2e-owner-init', '1');
      for (const [k, value] of Object.entries(v)) localStorage.setItem(k, value);
    },
    {
      'vamar.refresh': session.refreshToken,
      'vamar.device': session.deviceId,
      'vamar.lang': lang,
      'vamar.owner': JSON.stringify(owner),
    },
  );
  const page = await context.newPage();
  const open = async (path: string) => {
    await page.goto(`${OWNER_APP_URL}${path.startsWith('/') ? path : `/${path}`}`);
    // The signed-in screens never show the sign-in button; wait for the app to have started.
    await page.waitForFunction(() => document.body.innerText.trim().length > 0);
    if (await page.getByText(SIGN_IN).count()) {
      throw new Error(`the owner web app showed the sign-in screen at ${path}`);
    }
  };
  return {
    context,
    page,
    owner,
    open,
    close: async () => {
      await context.close();
    },
  };
}
