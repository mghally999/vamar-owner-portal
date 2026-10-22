/**
 * Local development server: runs the same Hono app on Node instead of workerd so the plain `pg`
 * driver talks to the local Postgres without any proxy, and files land in a folder instead of R2.
 * Deployed environments still run on Cloudflare Workers (wrangler deploy / dev:wrangler).
 *
 * Reads apps/api/.dev.vars (same names as the Worker secrets) and serves the built dashboard from
 * ../dashboard/dist when it exists, so `pnpm --filter @vamar/api dev` alone gives a full stack.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { app } from './app.js';
import { runDailyJobs } from './cron.js';
import type { Bindings } from './env.js';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');

function loadDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = join(apiDir, '.dev.vars');
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1] && !line.trim().startsWith('#')) out[m[1]] = (m[2] ?? '').replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Minimal R2Bucket backed by a local folder (dev only). */
function folderBucket(dir: string): R2Bucket {
  mkdirSync(dir, { recursive: true });
  const pathOf = (key: string) => join(dir, key.replace(/[^a-zA-Z0-9/_.-]/g, '_'));
  const bucket = {
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: R2PutOptions,
    ) {
      let bytes: Uint8Array;
      if (value instanceof ReadableStream)
        bytes = new Uint8Array(await new Response(value).arrayBuffer());
      else if (typeof value === 'string') bytes = new TextEncoder().encode(value);
      else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
      else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else if (value) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      else bytes = new Uint8Array();
      const p = pathOf(key);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
      writeFileSync(`${p}.meta.json`, JSON.stringify(options?.httpMetadata ?? {}));
      return { key } as unknown as R2Object;
    },
    async get(key: string) {
      const p = pathOf(key);
      if (!existsSync(p)) return null;
      const body = await readFile(p);
      let meta: R2HTTPMetadata = {};
      try {
        meta = JSON.parse(readFileSync(`${p}.meta.json`, 'utf8')) as R2HTTPMetadata;
      } catch {
        // no metadata
      }
      const copy = new Uint8Array(body);
      return {
        key,
        body: new Blob([copy]).stream(),
        httpMetadata: meta,
        etag: String(statSync(p).mtimeMs),
        size: body.length,
      } as unknown as R2ObjectBody;
    },
    delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) {
        const p = pathOf(k);
        for (const f of [p, `${p}.meta.json`]) if (existsSync(f)) unlinkSync(f);
      }
      return Promise.resolve();
    },
    head(key: string) {
      return Promise.resolve(existsSync(pathOf(key)) ? ({ key } as unknown as R2Object) : null);
    },
  };
  return bucket as unknown as R2Bucket;
}

const vars = loadDevVars();
const env: Bindings = {
  FILES: folderBucket(join(apiDir, '.dev-files')),
  DATABASE_URL:
    vars['DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    'postgres://vamar:vamar@localhost:5433/vamar',
  JWT_SECRET: vars['JWT_SECRET'] ?? 'dev-only-change-me-dev-only-change-me-dev-only',
  TOTP_ENC_KEY: vars['TOTP_ENC_KEY'] ?? 'ZGV2LW9ubHktdG90cC1rZXktMzItYnl0ZXMtbG9uZyEh',
  FIREBASE_PROJECT_ID: vars['FIREBASE_PROJECT_ID'] ?? 'demo-vamar',
  FIREBASE_AUTH_EMULATOR_HOST: vars['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099',
  EXPO_ACCESS_TOKEN: vars['EXPO_ACCESS_TOKEN'] ?? '',
  ALLOWED_PHONE_COUNTRIES: vars['ALLOWED_PHONE_COUNTRIES'] ?? 'AE',
  APP_ENV: 'development',
};

const pending = new Set<Promise<unknown>>();
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    pending.add(p);
    void p.finally(() => pending.delete(p));
  },
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

const dist = resolve(apiDir, '..', 'dashboard', 'dist');
const root = new Hono();
root.all('/api/*', (c) => app.fetch(c.req.raw, env, ctx));
root.get('/healthz', (c) => app.fetch(c.req.raw, env, ctx));
root.get('/readyz', (c) => app.fetch(c.req.raw, env, ctx));
root.get('/privacy', (c) => app.fetch(c.req.raw, env, ctx));
root.post('/__cron', async (c) => c.json(await runDailyJobs(env)));
if (existsSync(dist)) {
  root.use(
    '/*',
    serveStatic({
      root: dist,
      rewriteRequestPath: (p) =>
        existsSync(join(dist, p)) && statSync(join(dist, p)).isFile() ? p : '/index.html',
    }),
  );
}

const port = Number(process.env['PORT'] ?? 8787);
const hostname = process.env['HOST'] ?? '127.0.0.1';
serve({ fetch: root.fetch, port, hostname }, () => {
  console.info(
    `API (Node dev server) on http://127.0.0.1:${port}  db=${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}  dashboard=${existsSync(dist) ? dist : 'not built'}`,
  );
});
