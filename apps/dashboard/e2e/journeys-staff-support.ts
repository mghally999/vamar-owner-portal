/**
 * Support for journeys-staff.spec.ts: the staff API as the signed-in admin (the token the page
 * itself uses, read from its own requests), local-database set-up that makes each journey
 * rerunnable, and the RTL checks used by the Arabic journeys.
 */
import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { resetLoginCounters, withLocalDb } from './db';
import { LOCAL_STAFF_PASSWORD } from './helpers';

/**
 * The journeys sign in as their own admin, not the demo admin: other specs (and other runs of
 * the suite) reset and enrol the demo admin's authenticator, which would race with these.
 */
export const JOURNEY_ADMIN = {
  email: 'journeys-admin@vamar.test',
  uid: 'e2e-journeys-admin',
  name: 'Journeys Admin',
  password: LOCAL_STAFF_PASSWORD,
};

/** Create the journeys admin in the Auth emulator and the local database (once; idempotent). */
export async function ensureJourneyAdmin(): Promise<void> {
  const emulator = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099';
  const res = await fetch(
    `http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: JOURNEY_ADMIN.uid,
        email: JOURNEY_ADMIN.email,
        password: JOURNEY_ADMIN.password,
        emailVerified: true,
      }),
    },
  );
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error
      ?.message;
    if (!/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(msg ?? ''))
      throw new Error(`Auth emulator refused the journeys admin: ${msg ?? String(res.status)}`);
  }
  await withLocalDb((c) =>
    c.query(
      `insert into staff_users (id, firebase_uid, email, name, role)
       values (gen_random_uuid(), $1, $2, $3, 'admin')
       on conflict (email) do update set role = 'admin', active = true`,
      [JOURNEY_ADMIN.uid, JOURNEY_ADMIN.email, JOURNEY_ADMIN.name],
    ),
  );
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from a base32 secret. */
function totp(secretBase32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/[^A-Z2-7]/gi, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = new Uint8Array((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 30_000)));
  const h = new Uint8Array(createHmac('sha1', key).update(counter).digest());
  const offset = (h[h.length - 1] ?? 0) & 0x0f;
  const value = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(offset);
  return ((value & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/**
 * Sign the journeys admin in through the real login page. The authenticator is reset first, so
 * every sign-in enrols afresh from the key on screen: no secret to keep between runs and no
 * waiting for an unused 30-second step.
 */
export async function loginJourneyAdmin(page: Page, lang: 'ar' | 'en'): Promise<void> {
  await page.addInitScript((l) => {
    localStorage.setItem('vamar.lang', l);
  }, lang);
  await resetLoginCounters(JOURNEY_ADMIN.email);
  await withLocalDb((c) =>
    c.query(
      `update staff_users
          set totp_enabled = false, totp_secret_enc = null, totp_failures = 0,
              totp_locked_until = null, totp_last_step = null
        where email = $1`,
      [JOURNEY_ADMIN.email],
    ),
  );
  await page.goto('/login');
  await page.getByLabel(/البريد الإلكتروني|Email/).fill(JOURNEY_ADMIN.email);
  await page.getByLabel(/كلمة المرور|Password/).fill(JOURNEY_ADMIN.password);
  await page.getByRole('button', { name: /تسجيل الدخول|Sign in/ }).click();
  const secretEl = page.locator('code[dir="ltr"]');
  await secretEl.waitFor({ timeout: 45_000 });
  const secret = (await secretEl.textContent())?.replace(/\s/g, '') ?? '';
  // A code close to the end of its 30 s window may be stale by the time it arrives.
  if (Date.now() % 30_000 > 26_000) await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 300);
  await page
    .getByLabel(/الرمز|Code/)
    .first()
    .fill(totp(secret));
  await page.getByRole('button', { name: /تحقق|Verify/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });
}

/** Today in Dubai (UTC+4, no daylight saving) as yyyy-mm-dd, the API's own "today". */
export function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd as the date pickers' typed form, dd/mm/yyyy. */
export function typedDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d ?? ''}/${m ?? ''}/${y ?? ''}`;
}

/**
 * Remember the bearer token the dashboard sends with its staff requests. Call before login();
 * the returned function waits for the first token.
 */
export function trackStaffToken(page: Page): () => Promise<string> {
  let token: string | null = null;
  page.on('request', (r) => {
    if (!r.url().includes('/api/staff/')) return;
    const auth = r.headers()['authorization'];
    if (auth?.startsWith('Bearer ')) token = auth;
  });
  return async () => {
    await expect.poll(() => token, { timeout: 15_000 }).not.toBeNull();
    return token ?? '';
  };
}

export type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

/** Call the staff API as the signed-in user; throws with the response body on failure. */
export function staffApi(page: Page, token: () => Promise<string>): Api {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await page.request.fetch(path, {
      method,
      headers: {
        authorization: await token(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { data: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${String(res.status())}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  };
}

/** One value from the local database. */
export async function dbOne<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await dbAll<T>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`no row for: ${sql} ${JSON.stringify(params)}`);
  return row;
}

export async function dbAll<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withLocalDb(async (c) => (await c.query<T>(sql, params)).rows);
}

/**
 * Put seeded cheques back to "deposited on `depositedOn`", as the bank statement fixture expects.
 * A previous run of the statement journey cleared or bounced them; their later events go too, so
 * the timeline reads as it did after the seed. Local demo database only (withLocalDb refuses
 * anything else).
 */
export async function resetChequesToDeposited(chequeNos: string[], depositedOn: string) {
  await withLocalDb(async (c) => {
    const { rows } = await c.query<{ id: string; cheque_no: string }>(
      `select id, cheque_no from cheques where cheque_no = any($1::text[])`,
      [chequeNos],
    );
    const missing = chequeNos.filter((n) => !rows.some((r) => r.cheque_no === n));
    if (missing.length || rows.length !== chequeNos.length)
      throw new Error(
        `seeded cheques ${missing.join(', ')} not found exactly once; reseed the local database`,
      );
    const ids = rows.map((r) => r.id);
    await c.query(
      `delete from cheque_events
        where cheque_id = any($1::uuid[]) and to_status in ('cleared', 'bounced')`,
      [ids],
    );
    await c.query(
      `update cheques
          set status = 'deposited',
              deposited_at = ($2::date + time '12:00') at time zone 'Asia/Dubai',
              status_changed_at = ($2::date + time '12:00') at time zone 'Asia/Dubai',
              cleared_at = null, bounced_at = null, bounce_reason = null
        where id = any($1::uuid[])`,
      [ids, depositedOn],
    );
  });
}

/** Remove renewal drafts made from a contract by an earlier run (drafts only; nothing else). */
export async function deleteRenewalDrafts(contractId: string) {
  await withLocalDb(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `select id from contracts where previous_contract_id = $1 and status = 'draft'`,
      [contractId],
    );
    const ids = rows.map((r) => r.id);
    if (!ids.length) return;
    await c.query(
      `delete from cheque_events where cheque_id in
         (select id from cheques where contract_id = any($1::uuid[]))`,
      [ids],
    );
    await c.query(`delete from cheques where contract_id = any($1::uuid[])`, [ids]);
    await c.query(`delete from contracts where id = any($1::uuid[])`, [ids]);
  });
}

/**
 * The page is laid out right to left: the document says so, the sidebar sits on the right of
 * the content (on desktop widths) and nothing spills past the window sideways.
 */
export async function expectRtl(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  const layout = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    const main = document.querySelector('main');
    const n = nav?.getBoundingClientRect();
    const m = main?.getBoundingClientRect();
    return {
      navLeft: n && n.width > 0 ? n.left : null,
      mainLeft: m ? m.left : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      culprits: [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(
          ({ r }) =>
            r.width > 0 && (r.left < -1 || r.right > document.documentElement.clientWidth + 1),
        )
        .slice(0, 8)
        .map(
          ({ el, r }) =>
            `${el.tagName}.${el.getAttribute('class')?.slice(0, 60) ?? ''} ${String(Math.round(r.left))}..${String(Math.round(r.right))}`,
        ),
    };
  });
  if (layout.navLeft !== null && layout.mainLeft !== null)
    expect(layout.navLeft, 'the sidebar is on the right in Arabic').toBeGreaterThan(
      layout.mainLeft,
    );
  expect(layout.overflow, `no sideways scroll: ${layout.culprits.join(' | ')}`).toBeLessThanOrEqual(
    1,
  );
}
