#!/usr/bin/env node
/**
 * `pnpm demo:reset`: puts the demo data back to its starting state after a rehearsal, on the
 * local database (DATABASE_URL from .env) and on the live demo database when
 * `.local/neon.env` exists on this machine (gitignored; holds the Neon owner connection string).
 * Logins survive: staff authenticator, dashboard sessions, owner app sessions and devices.
 *
 *   pnpm demo:reset            local + live (if .local/neon.env is present)
 *   pnpm demo:reset --local    local only
 *   pnpm demo:reset --live     live only (production, demo data only while DEMO_TRIAL is on)
 *   pnpm demo:reset --staging  staging only (.local/neon-staging.env)
 *
 * The demo attachments (invoice images, work-order photos) are written to .local/demo-files/<label>
 * and, for live and staging, uploaded to the matching R2 bucket with wrangler (logged in).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const wantLocal = args.size === 0 || args.has('--local');
const wantLive = args.size === 0 || args.has('--live');
const wantStaging = args.has('--staging');

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function run(label, databaseUrl, filesDir) {
  const r = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@vamar/db', 'exec', 'tsx', 'scripts/demo-reset.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DEMO_RESET_LABEL: label,
        DEMO_FILES_DIR: filesDir,
      },
    },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Every file under dir (skipping the .meta.json sidecars) as [key, path, contentType]. */
function demoFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!name.endsWith('.meta.json')) {
        let contentType = 'application/octet-stream';
        try {
          contentType =
            JSON.parse(readFileSync(`${p}.meta.json`, 'utf8')).contentType ?? contentType;
        } catch {
          // no sidecar
        }
        out.push([relative(dir, p).split('\\').join('/'), p, contentType]);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Upload the demo attachments to the environment's bucket (wrangler must be logged in). */
function uploadFiles(label, bucket, dir) {
  const files = demoFiles(dir);
  for (const [key, path, contentType] of files) {
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/${key}`,
        '--file',
        path,
        '--content-type',
        contentType,
        '--remote',
      ],
      { cwd: join(root, 'apps', 'api'), stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  console.log(`[${label}] ${files.length} demo files uploaded to ${bucket}`);
}

if (wantLocal) {
  const local = existsSync(join(root, '.env')) ? parseEnv(join(root, '.env')) : {};
  run(
    'local',
    process.env.DATABASE_URL ?? local.DATABASE_URL ?? 'postgres://vamar:vamar@localhost:5433/vamar',
    join(root, 'apps', 'api', '.dev-files'),
  );
}
function remote(label, envFile, bucket) {
  const file = join(root, '.local', envFile);
  if (!existsSync(file)) {
    console.log(`[${label}] skipped: .local/${envFile} not found on this machine`);
    return;
  }
  const env = parseEnv(file);
  if (!env.DATABASE_URL) {
    console.error(`[${label}] .local/${envFile} has no DATABASE_URL`);
    process.exit(1);
  }
  const dir = join(root, '.local', 'demo-files', label);
  run(label, env.DATABASE_URL, dir);
  uploadFiles(label, bucket, dir);
}
if (wantStaging) remote('staging', 'neon-staging.env', 'vamar-files-staging');
if (wantLive) remote('live', 'neon.env', 'vamar-files');
