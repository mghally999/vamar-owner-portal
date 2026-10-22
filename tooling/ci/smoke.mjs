#!/usr/bin/env node
/**
 * Post-deploy smoke test: node tooling/ci/smoke.mjs <baseUrl> <expected APP_ENV>
 * Retries for a minute (a fresh deploy and a waking Neon branch can take a few seconds).
 */
const [base, expectedEnv] = process.argv.slice(2);
if (!base || !expectedEnv) {
  console.error('usage: smoke.mjs <baseUrl> <expected APP_ENV>');
  process.exit(2);
}

async function get(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

const checks = [
  async () => {
    const r = await get('/healthz');
    const body = JSON.parse(r.text);
    if (r.status !== 200 || body.env !== expectedEnv)
      throw new Error(`/healthz ${r.status} ${r.text}`);
  },
  async () => {
    const r = await get('/readyz');
    if (r.status !== 200 || !JSON.parse(r.text).db)
      throw new Error(`/readyz ${r.status} ${r.text}`);
  },
  async () => {
    const r = await get('/api/owner/me');
    if (r.status !== 401) throw new Error(`/api/owner/me expected 401, got ${r.status}`);
    if (r.headers.get('cache-control') !== 'no-store') throw new Error('API response is cacheable');
    if (!r.headers.get('x-request-id')) throw new Error('no x-request-id');
    if ((r.headers.get('content-security-policy') ?? '').includes('9099'))
      throw new Error('CSP still allows the Auth emulator');
  },
  async () => {
    const r = await get('/login');
    if (r.status !== 200 || !r.text.includes('<div id="root">'))
      throw new Error(`/login ${r.status}`);
  },
];

const deadline = Date.now() + 60_000;
for (const [i, check] of checks.entries()) {
  for (;;) {
    try {
      await check();
      console.log(`ok ${i + 1}/${checks.length}`);
      break;
    } catch (e) {
      if (Date.now() > deadline) {
        console.error(`smoke test failed: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}
console.log(`smoke test passed for ${base} (${expectedEnv})`);
