// Owner app screenshots for demo/screenshots/v2/app, from the web build of the same screens
// (apps/dashboard/dist/app, `pnpm build:web`) served by the local API dev server, on an iPhone 13
// screen, in both themes and both languages.
//
//   node tooling/dev/app-screenshots.mjs [baseUrl] [phone]
//
// Signs the demo owner in by writing a device and a session straight into the local database
// (no SMS): refuses any database that is not on this machine.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';
import pg from 'pg';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const phone = process.argv[3] ?? '+971500000001';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Refusing to write a session into a database that is not local');
}
const out = resolve(import.meta.dirname, '..', '..', 'demo', 'screenshots', 'v2', 'app');
mkdirSync(out, { recursive: true });

const db = new pg.Client({ connectionString: url });
await db.connect();
const one = async (q, params) => (await db.query(q, params)).rows[0];

const owner = await one(
  `select id, name_ar as "nameAr", name_en as "nameEn", preferred_lang as "preferredLang"
   from owners where phone_e164 = $1`,
  [phone],
);
if (!owner) throw new Error(`no owner with phone ${phone}`);
const cheque = await one(
  `select c.id from cheques c join contracts k on k.id = c.contract_id
   join unit_ownerships u on u.unit_id = k.unit_id and u.to_date is null
   where u.owner_id = $1 order by (c.status = 'bounced') desc, c.due_date limit 1`,
  [owner.id],
);
const unit = await one(
  `select unit_id as id from unit_ownerships where owner_id = $1 and to_date is null limit 1`,
  [owner.id],
);
const dispute = await one(
  `select d.id from disputes d join unit_ownerships u on u.unit_id = d.unit_id and u.to_date is null
   where u.owner_id = $1 limit 1`,
  [owner.id],
);

/** A fresh device and refresh token for one browser context. */
async function signIn() {
  const deviceId = `web-shots-${randomUUID()}`;
  const refreshToken = randomBytes(32).toString('base64url');
  await db.query(
    `insert into devices (id, owner_id, device_id, platform, model) values ($1, $2, $3, 'web', 'screenshots')`,
    [randomUUID(), owner.id, deviceId],
  );
  await db.query(
    `insert into sessions (id, subject_type, subject_id, device_id, token_hash, expires_at)
     values ($1, 'owner', $2, $3, $4, now() + interval '1 hour')`,
    [randomUUID(), owner.id, deviceId, createHash('sha256').update(refreshToken).digest('hex')],
  );
  return { deviceId, refreshToken };
}

const SCREENS = [
  ['home', '/app/'],
  ['cheques', '/app/cheques'],
  ['properties', '/app/properties'],
  ['disputes', '/app/disputes'],
  ['settings', '/app/settings'],
  ...(cheque ? [['cheque', `/app/cheque/${cheque.id}`]] : []),
  ...(unit ? [['unit', `/app/unit/${unit.id}`]] : []),
  ...(dispute ? [['dispute', `/app/dispute/${dispute.id}`]] : []),
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
try {
  for (const theme of ['default', 'white']) {
    for (const lang of ['ar', 'en']) {
      const { deviceId, refreshToken } = await signIn();
      const context = await browser.newContext({
        ...devices['iPhone 13'],
        locale: lang === 'ar' ? 'ar-AE' : 'en-AE',
        serviceWorkers: 'block',
      });
      await context.addInitScript(
        (v) => {
          if (sessionStorage.getItem('shots-init')) return;
          sessionStorage.setItem('shots-init', '1');
          for (const [k, value] of Object.entries(v)) localStorage.setItem(k, value);
        },
        {
          'vamar.refresh': refreshToken,
          'vamar.device': deviceId,
          'vamar.lang': lang,
          'vamar.theme': theme,
          'vamar.owner': JSON.stringify(owner),
        },
      );
      const page = await context.newPage();
      for (const [name, path] of SCREENS) {
        // The app polls in the background, so the network never goes idle: wait for the session
        // refresh every page load starts with, then give the screen time to fetch and render.
        const refreshed = page.waitForResponse(
          (r) => r.url().endsWith('/api/auth/owner/refresh') && r.status() === 200,
          { timeout: 90_000 },
        );
        await page.goto(`${base}${path}`);
        await refreshed;
        await page.waitForTimeout(4000);
        const file = resolve(out, `${name}-${theme}-${lang}.png`);
        await page.screenshot({ path: file });
        console.info(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await db.end();
}
