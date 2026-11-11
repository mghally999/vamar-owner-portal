// Owner app screenshots for demo/screenshots/<round>/app, from the web build of the same screens
// (apps/dashboard/dist/app, `pnpm build:web`) served by the local API dev server, on an iPhone 13
// screen, in both themes and both languages.
//
//   node tooling/dev/app-screenshots.mjs [baseUrl] [phone]
//
// Signs the demo owner in by writing a device and a session straight into the local database
// (no SMS): refuses any database that is not on this machine. Every capture is checked to be the
// signed-in screen (never the sign-in page), and the run fails when two files are identical.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
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
const out = process.env.SCREENSHOT_DIR
  ? resolve(process.env.SCREENSHOT_DIR)
  : resolve(import.meta.dirname, '..', '..', 'demo', 'screenshots', 'v3', 'app');
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
   where u.owner_id = $1 order by (d.type = 'bounced_cheque') desc limit 1`,
  [owner.id],
);
const expense = await one(
  `select x.id from expenses x join expense_allocations a on a.expense_id = x.id
   where a.owner_id = $1 and x.status = 'posted' and x.visible_to_owner
   order by exists (select 1 from attachments t where t.entity_type = 'expense' and t.entity_id = x.id) desc, x.invoice_date desc limit 1`,
  [owner.id],
);
const workOrder = await one(
  `select w.id from work_orders w join unit_ownerships u on u.unit_id = w.unit_id and u.to_date is null
   where u.owner_id = $1 and w.visible_to_owner order by (w.status = 'done') desc, w.reported_on desc limit 1`,
  [owner.id],
);
// v3: a repair waiting for this owner's answer (else any of theirs) and their newest thread.
const approval = await one(
  `select id from repair_approvals where owner_id = $1 order by (status = 'pending') desc, created_at desc limit 1`,
  [owner.id],
);
const thread = await one(
  `select id from message_threads where owner_id = $1 order by created_at desc limit 1`,
  [owner.id],
);
// The month before this one, as the monthly summary push links it (Home shows the statement card).
const lastMonth = await one(
  `select to_char(date_trunc('month', now() at time zone 'Asia/Dubai') - interval '1 month', 'YYYY-MM-DD') as "from",
          to_char(date_trunc('month', now() at time zone 'Asia/Dubai') - interval '1 day', 'YYYY-MM-DD') as "to"`,
);

// Devices left by earlier runs would pile up in Settings' signed-in devices list.
await db.query(
  `delete from sessions where device_id in (select device_id from devices where owner_id = $1 and model = 'screenshots')`,
  [owner.id],
);
await db.query(`delete from devices where owner_id = $1 and model = 'screenshots'`, [owner.id]);

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
  ['expenses', '/app/expenses'],
  ...(expense ? [['expense', `/app/expense/${expense.id}`]] : []),
  ['calendar', '/app/calendar'],
  ['work-orders', '/app/work-orders'],
  ...(workOrder ? [['work-order', `/app/work-order/${workOrder.id}`]] : []),
  ['home-year', '/app/?preset=this_year'],
  // v3
  ...(approval ? [['approval', `/app/repair-approval/${approval.id}`]] : []),
  ['approvals', '/app/repair-approvals'],
  ['messages', '/app/messages'],
  ...(thread ? [['message-thread', `/app/message/${thread.id}`]] : []),
  ['message-new', '/app/message/new'],
  ['settings-year', '/app/settings', /^(Yearly statement \(PDF\)|كشف الحساب السنوي PDF)$/],
  ['home-statement', `/app/?from=${lastMonth.from}&to=${lastMonth.to}&statement=1`],
];

const browser = await chromium.launch(
  process.env.PW_EXECUTABLE
    ? { executablePath: process.env.PW_EXECUTABLE }
    : { channel: process.env.PW_CHANNEL ?? 'msedge' },
);
const SIGN_IN = /^(Sign in|تسجيل الدخول)$/;
const written = [];
// SCREENSHOT_COMBOS=default-ar,white-en takes only those combinations (one browser context at a
// time keeps memory low on small machines); the duplicate check below still covers every file.
const combos = process.env.SCREENSHOT_COMBOS?.split(',').map((c) => c.trim());
try {
  for (const theme of ['default', 'white']) {
    for (const lang of ['ar', 'en']) {
      if (combos && !combos.includes(`${theme}-${lang}`)) continue;
      let session = await signIn();
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
          'vamar.refresh': session.refreshToken,
          'vamar.device': session.deviceId,
          'vamar.lang': lang,
          'vamar.theme': theme,
          'vamar.owner': JSON.stringify(owner),
        },
      );
      const page = await context.newPage();
      for (const [name, path, scrollTo] of SCREENS) {
        // The app polls in the background, so the network never goes idle: wait for the session
        // refresh every page load starts with, then give the screen time to fetch and render.
        const refreshed = page.waitForResponse(
          (r) => r.url().endsWith('/api/auth/owner/refresh') && r.status() === 200,
          { timeout: 90_000 },
        );
        await page.goto(`${base}${path}`);
        await refreshed.catch(() => undefined);
        await page.waitForTimeout(4000);
        // Never save the sign-in page under another screen's name: sign in again and retry.
        for (let attempt = 0; (await page.getByText(SIGN_IN).count()) > 0; attempt++) {
          if (attempt === 2) throw new Error(`${name} ${theme} ${lang}: stuck on the sign-in page`);
          session = await signIn();
          await page.evaluate(
            ({ r, d }) => {
              localStorage.setItem('vamar.refresh', r);
              localStorage.setItem('vamar.device', d);
            },
            { r: session.refreshToken, d: session.deviceId },
          );
          await page.goto(`${base}${path}`);
          await page.waitForTimeout(6000);
        }
        // Screens whose subject sits below the fold: bring it to the top of the picture. (The
        // Properties tab needs none: the budget card is at the top of its first building.)
        if (scrollTo) {
          const target =
            typeof scrollTo === 'string' ? page.locator(scrollTo) : page.getByText(scrollTo);
          await target.first().evaluate((el) => {
            el.scrollIntoView({ block: 'start' });
          });
          await page.waitForTimeout(500);
        }
        const file = resolve(out, `${name}-${theme}-${lang}.png`);
        await page.screenshot({ path: file });
        written.push(file);
        console.info(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await db.end();
}

// Two identical files mean a screen did not render what its name says (or did not change theme).
const seen = new Map();
let duplicates = 0;
const all = readdirSync(out)
  .filter((f) => f.endsWith('.png'))
  .map((f) => resolve(out, f));
for (const file of all) {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const other = seen.get(hash);
  if (other) {
    console.error(`identical screenshots: ${other} and ${file}`);
    duplicates += 1;
  } else seen.set(hash, file);
}
if (duplicates > 0) process.exit(1);
console.info(
  `${String(written.length)} screenshots taken, ${String(all.length)} in the folder, all different`,
);
