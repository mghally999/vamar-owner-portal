/**
 * Shared helpers for the staging QA scripts (tooling/qa/staging-*.mjs). STAGING ONLY:
 *  - the base URL is fixed to the staging Worker and /healthz must answer env=staging;
 *  - the database URL comes from .local/neon-staging.env and its host must be the staging branch
 *    endpoint recorded in .local/neon-staging-branch.json and differ from .local/neon.env.
 * No secret is ever printed.
 *
 * Sessions: owners and staff normally sign in through Firebase (phone OTP / email + password,
 * then the authenticator for staff). These scripts instead write a device and a refresh session
 * row for the account straight into the staging database (as apps/dashboard/e2e/owner-session.ts
 * does locally) and turn it into an access token with the real /api/auth/{owner,staff}/refresh.
 * Every device made here has the model QA_MODEL, so cleanup() finds them all.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import pg from 'pg';

// Node tries each Neon address for only 250 ms by default; on a slow line every attempt times out.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STAGING = 'https://vamar-owner-portal-staging.vamar-api.workers.dev';
export const QA_MODEL = 'qa-staging';
export const QA_TAG = '[QA staging]';

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** The staging owner connection string, after checking it really is the staging branch. */
function stagingDatabaseUrl() {
  const env = parseEnv(join(ROOT, '.local', 'neon-staging.env'));
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing in .local/neon-staging.env');
  const host = new URL(url).hostname;
  const branch = JSON.parse(readFileSync(join(ROOT, '.local', 'neon-staging-branch.json'), 'utf8'));
  const stagingHosts = (branch.endpoints ?? []).map((e) => e.host);
  if (!stagingHosts.includes(host))
    throw new Error('refusing: DATABASE_URL is not the staging endpoint');
  const prodFile = join(ROOT, '.local', 'neon.env');
  if (existsSync(prodFile)) {
    const prod = parseEnv(prodFile);
    for (const v of [prod.DATABASE_URL, prod.DATABASE_URL_APP].filter(Boolean)) {
      if (new URL(v).hostname === host)
        throw new Error('refusing: staging URL points at production');
    }
  }
  return url;
}

let pool;
export async function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: stagingDatabaseUrl().replace(/sslmode=require/, 'sslmode=verify-full'),
      max: 3,
      connectionTimeoutMillis: 20_000,
    });
  }
  return pool;
}
/** A query; a failed connect (this machine's line drops now and then) is tried again. */
export async function q(sql, params = []) {
  for (let attempt = 1; ; attempt++) {
    let conn;
    try {
      conn = await (await db()).connect();
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    try {
      return await conn.query(sql, params);
    } finally {
      conn.release();
    }
  }
}
export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}

export async function assertStaging() {
  const r = await fetch(`${STAGING}/healthz`);
  const j = await r.json();
  if (j.env !== 'staging') throw new Error(`refusing: ${STAGING}/healthz env=${j.env}`);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** A JSON API client with a bearer token; returns { status, json, text, headers }. */
export function client(token) {
  return async function api(method, path, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (token) headers.authorization = `Bearer ${token}`;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const t0 = Date.now();
    const res = await fetch(`${STAGING}${path}`, { method, headers, body: payload });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: res.status,
      json,
      text,
      bytes: buf.length,
      headers: res.headers,
      ms: Date.now() - t0,
    };
  };
}

/** Signs an owner in: device + refresh session in the staging DB, then the real /refresh. */
export async function ownerSession(phone, { pushToken = null } = {}) {
  const { rows } = await q(
    `select id, name_en as "nameEn", status from owners where phone_e164 = $1`,
    [phone],
  );
  const owner = rows[0];
  if (!owner) throw new Error(`no owner with phone ${phone} on staging`);
  const deviceId = `qa-staging-${randomUUID()}`;
  const refresh = randomBytes(32).toString('hex');
  await q(
    `insert into devices (id, owner_id, device_id, platform, model, push_token) values ($1, $2, $3, 'android', $4, $5)`,
    [randomUUID(), owner.id, deviceId, QA_MODEL, pushToken],
  );
  await q(
    `insert into sessions (id, subject_type, subject_id, device_id, token_hash, expires_at)
     values ($4, 'owner', $1, $2, $3, now() + interval '2 hours')`,
    [owner.id, deviceId, sha256(refresh), randomUUID()],
  );
  const r = await client()('POST', '/api/auth/owner/refresh', { refreshToken: refresh, deviceId });
  if (r.status !== 200 || !r.json?.accessToken)
    throw new Error(`owner refresh ${r.status} ${r.text.slice(0, 200)}`);
  return {
    owner,
    deviceId,
    refreshToken: r.json.refreshToken,
    accessToken: r.json.accessToken,
    api: client(r.json.accessToken),
  };
}

/** Signs a staff user in: session row in the staging DB, then the real cookie /refresh. */
export async function staffSession(email) {
  const { rows } = await q(
    `select id, role, active from staff_users where lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];
  if (!user?.active) throw new Error(`no active staff user ${email} on staging`);
  const refresh = randomBytes(32).toString('hex');
  const ins = await q(
    `insert into sessions (id, subject_type, subject_id, device_id, token_hash, expires_at)
     values ($3, 'staff', $1, null, $2, now() + interval '1 hour') returning id`,
    [user.id, sha256(refresh), randomUUID()],
  );
  qaStaffSessionIds.push(ins.rows[0].id);
  const r = await client()('POST', '/api/auth/staff/refresh', undefined, {
    cookie: `vamar_staff_refresh=${refresh}`,
  });
  if (r.status !== 200 || !r.json?.accessToken)
    throw new Error(`staff refresh ${r.status} ${r.text.slice(0, 200)}`);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const cookie = /vamar_staff_refresh=([^;]+)/.exec(setCookie)?.[1];
  return { user, accessToken: r.json.accessToken, cookie, api: client(r.json.accessToken) };
}

const qaStaffSessionIds = [];

/**
 * Removes every QA device and the owner sessions bound to them, and deletes the staff session
 * chains these scripts started (only those: a real dashboard sign-in is left alone).
 */
export async function cleanupQaSessions() {
  const s = await q(
    `delete from sessions where subject_type = 'owner' and device_id like 'qa-staging-%' returning id`,
  );
  const d = await q(`delete from devices where model = $1 returning id`, [QA_MODEL]);
  let st = { rowCount: 0 };
  if (qaStaffSessionIds.length) {
    st = await q(
      `with recursive chain as (
         select id from sessions where id = any($1::uuid[])
         union select s.id from sessions s join chain on s.rotated_from = chain.id)
       delete from sessions where id in (select id from chain) returning id`,
      [qaStaffSessionIds],
    );
    qaStaffSessionIds.length = 0;
  }
  return { ownerSessions: s.rowCount, devices: d.rowCount, staffSessions: st.rowCount };
}

/** Tiny assertion recorder: every check is kept for the report. */
export function recorder() {
  const results = [];
  const check = (name, ok, evidence = '') => {
    results.push({ name, ok: Boolean(ok), evidence: String(evidence).slice(0, 300) });
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  -- ${String(evidence).slice(0, 200)}` : ''}`,
    );
    return Boolean(ok);
  };
  return { results, check };
}
