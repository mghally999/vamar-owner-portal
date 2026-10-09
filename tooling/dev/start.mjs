#!/usr/bin/env node
/**
 * One command for local development without Docker:
 *   1. PostgreSQL (started with pg_ctl if a local cluster exists and is not running)
 *   2. Firebase Auth emulator (needs Java 11+ and firebase-tools)
 *   3. API (wrangler dev on :8787)
 *   4. Dashboard (vite on :5173, proxying /api to :8787)
 *
 * Configure with env vars (or a .env at the repo root):
 *   PGDATA_DIR   path of the local cluster (default C:\dev\pgdata); skip if empty/absent
 *   PG_BIN       PostgreSQL bin folder (default: C:\Program Files\PostgreSQL\17\bin)
 *   JAVA_HOME    JDK folder; auto-detected under C:\Program Files\Microsoft\jdk-* if unset
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWin = process.platform === 'win32';
const only = new Set(process.argv.slice(2)); // e.g. `node start.mjs api dashboard`
const want = (name) => only.size === 0 || only.has(name);

function portOpen(port, host = '127.0.0.1') {
  return new Promise((res) => {
    const s = createConnection({ port, host });
    s.once('connect', () => (s.destroy(), res(true)));
    s.once('error', () => res(false));
    s.setTimeout(800, () => (s.destroy(), res(false)));
  });
}

const children = [];
function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
    cwd: root,
    ...opts,
  });
  const tag = `[${name}]`.padEnd(12);
  child.stdout.on('data', (d) =>
    process.stdout.write(
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .map((l) => `${tag} ${l}\n`)
        .join(''),
    ),
  );
  child.stderr.on('data', (d) =>
    process.stderr.write(
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .map((l) => `${tag} ${l}\n`)
        .join(''),
    ),
  );
  child.on('exit', (code) => console.log(`${tag} exited with ${code}`));
  children.push(child);
  return child;
}

// 1. Postgres
const dbUrl = process.env.DATABASE_URL ?? 'postgres://vamar:vamar@localhost:5433/vamar';
const pgPort = Number(new URL(dbUrl).port || 5432);
if (want('db')) {
  if (await portOpen(pgPort)) console.log(`[postgres]   already listening on ${pgPort}`);
  else {
    const pgData = process.env.PGDATA_DIR ?? 'C:\\dev\\pgdata';
    const pgBin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
    if (existsSync(pgData)) {
      // shell: true concatenates arguments, so paths with spaces (C:Program Files) must be quoted.
      const q = (p) => (isWin ? `"${p}"` : p);
      const r = spawnSync(
        q(join(pgBin, 'pg_ctl')),
        ['-D', q(pgData), '-l', q(join(pgData, 'server.log')), '-w', 'start'],
        { stdio: 'inherit', shell: isWin },
      );
      console.log(`[postgres]   pg_ctl start exited with ${r.status}`);
    } else
      console.warn(
        `[postgres]   no cluster at ${pgData} and nothing on ${pgPort}; start Postgres yourself (see PROJECT.md)`,
      );
  }
}

// 2. Firebase emulator
if (want('firebase')) {
  if (await portOpen(9099)) console.log('[firebase]   emulator already listening on 9099');
  else {
    if (!process.env.JAVA_HOME && isWin) {
      const base = 'C:\\Program Files\\Microsoft';
      const jdk = existsSync(base)
        ? readdirSync(base).find((d) => d.startsWith('jdk-'))
        : undefined;
      if (jdk) {
        process.env.JAVA_HOME = join(base, jdk);
        process.env.PATH = `${join(base, jdk, 'bin')};${process.env.PATH}`;
      }
    }
    run(
      'firebase',
      'firebase',
      [
        'emulators:start',
        '--only',
        'auth',
        '--project',
        'demo-vamar',
        '--import',
        './tooling/firebase/data',
        '--export-on-exit',
        './tooling/firebase/data',
      ],
      { cwd: join(root, 'tooling', 'firebase') },
    );
  }
}

// 2b. Demo staff accounts in the emulator. The emulator keeps nothing between runs unless it
// exports on exit (a reboot or kill skips that), so recreate the two dashboard logins every start.
// Fixed localIds match the seed's firebase_uid values; EMAIL_EXISTS / DUPLICATE_LOCAL_ID are fine.
if (want('firebase')) {
  const demoStaff = [
    { localId: 'seed-staff-admin', email: 'admin@vamar.test' },
    { localId: 'seed-staff-entry', email: 'entry@vamar.test' },
  ];
  const password = process.env.DEMO_STAFF_PASSWORD ?? 'Vamar2026!';
  (async () => {
    for (let i = 0; i < 60 && !(await portOpen(9099)); i++)
      await new Promise((r) => setTimeout(r, 1000));
    for (const u of demoStaff) {
      try {
        const res = await fetch(
          'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
            body: JSON.stringify({ ...u, password, emailVerified: true }),
          },
        );
        const body = await res.json().catch(() => ({}));
        const msg = body?.error?.message ?? '';
        if (res.ok) console.log(`[firebase]   demo staff ${u.email} created`);
        else if (/EMAIL_EXISTS|DUPLICATE_LOCAL_ID/.test(msg))
          console.log(`[firebase]   demo staff ${u.email} present`);
        else console.warn(`[firebase]   could not create ${u.email}: ${msg || res.status}`);
      } catch (e) {
        console.warn(
          `[firebase]   could not reach the emulator to create demo staff: ${e.message}`,
        );
      }
    }
  })();
}

// 3 + 4. API and dashboard
if (want('api')) run('api', 'pnpm', ['--filter', '@vamar/api', 'dev']);
if (want('dashboard')) run('dashboard', 'pnpm', ['--filter', '@vamar/dashboard', 'dev']);

console.log(
  '\nDashboard: http://localhost:5173   API: http://localhost:8787   Firebase UI: http://localhost:4000\n',
);

function shutdown() {
  for (const c of children) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
