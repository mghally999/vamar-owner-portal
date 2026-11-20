/**
 * Authentication cannot be bypassed by the shape of the path. Hono's RegExpRouter skipped
 * wildcard middleware for paths with an encoded line terminator (GHSA-h7mg-cq63-vhpq), and
 * mount() could forward a path past middleware scoped inside the mount prefix
 * (GHSA-4m76-xfj5-7975). The owner API is guarded by wildcard middleware (`requireOwner` on
 * /api/owner/*), the staff API by middleware on every route, and the app-wide headers by
 * wildcards on * and /api/*.
 *
 * Every crafted path below must end in one of two ways without a token:
 * - `auth`: 401 from the auth middleware, or
 * - `no-route`: a 404 not_found that the right token also gets, so no handler sits behind it.
 * The expected outcome is written down per path, so a router that starts skipping the wildcard
 * (a 404 where a 401 is expected) fails the test.
 *
 * Today the default SmartRouter settles on TrieRouter for this app, which was never affected; the
 * last block pins the fixed behaviour of the RegExpRouter too, so a route change that makes
 * SmartRouter pick it, or a Hono downgrade, cannot bring the bypass back unnoticed.
 */
import { Hono } from 'hono';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { createWorld, type TestWorld } from './harness.js';

const KHALID = '+971500000001';
const ANY_ID = '0b6f2f3e-5a1d-4c47-9b51-6f0f4f8f2c11';
/** %0A, %0D, U+2028 and U+2029, the line terminators the RegExpRouter wildcard did not match. */
const TERMINATORS = ['%0A', '%0D', '%E2%80%A8', '%E2%80%A9'];

type Outcome = 'auth' | 'no-route';
interface Case {
  path: string;
  method?: string;
  expect: Outcome;
}

let w: TestWorld;
let owner: string;
let admin: string;
let viewer: string;
let ownerId: string;

beforeAll(async () => {
  w = await createWorld();
  owner = await w.ownerToken(KHALID);
  admin = await w.staffToken('admin@vamar.test');
  viewer = await w.staffToken('viewer@vamar.test');
  ownerId = w.ids.owners[KHALID]!;
});
afterAll(() => w.close());

/**
 * Calls the path without a token and checks the outcome. A 404 counts only when the token that
 * would open the real route also gets a 404 for the same path: nothing is reachable there.
 */
async function outcome(path: string, method: string, token: string): Promise<Outcome> {
  const anon = await w.request(path, { method });
  // The app-wide middleware ran: request id on everything, no-store on everything under /api/.
  expect(anon.headers.get('x-request-id'), path).toBeTruthy();
  if (path.startsWith('/api/')) expect(anon.headers.get('cache-control'), path).toBe('no-store');
  const text = await anon.text();
  if (anon.status === 401) {
    const body = JSON.parse(text) as { error?: { code?: string } };
    expect(body.error?.code, path).toBe('unauthorized');
    return 'auth';
  }
  expect(anon.status, `${method} ${path} without a token`).toBe(404);
  // Under /api/ the JSON envelope, elsewhere the plain-text page.
  if (anon.headers.get('content-type')?.includes('json'))
    expect((JSON.parse(text) as { error?: { code?: string } }).error?.code, path).toBe('not_found');
  else expect(text, path).toBe('Not found');
  const authed = await w.request(path, { method, token });
  expect(authed.status, `${method} ${path} with the right token`).toBe(404);
  return 'no-route';
}

async function check(cases: Case[], token: () => string) {
  const failures: string[] = [];
  for (const c of cases) {
    const method = c.method ?? 'GET';
    const got = await outcome(c.path, method, token());
    if (got !== c.expect) failures.push(`${method} ${c.path}: expected ${c.expect}, got ${got}`);
  }
  expect(failures).toEqual([]);
}

describe('owner API: wildcard requireOwner holds for crafted paths', () => {
  const routes = () => [
    '/api/owner/me',
    '/api/owner/units',
    `/api/owner/units/${ANY_ID}`,
    '/api/owner/summary',
    '/api/owner/approvals',
    `/api/owner/approvals/${ANY_ID}`,
    '/api/owner/budgets',
    '/api/owner/messages',
    `/api/owner/messages/${ANY_ID}`,
  ];

  it('the plain routes need an owner token', async () => {
    await check(
      routes().map((path) => ({ path, expect: 'auth' })),
      () => owner,
    );
  });

  it('encoded line terminators (%0A, %0D, U+2028, U+2029) still meet the guard', async () => {
    const cases: Case[] = [];
    for (const path of routes())
      for (const t of TERMINATORS) {
        cases.push({ path: `${path}${t}`, expect: 'auth' });
        cases.push({ path: `${path}${t}/x`, expect: 'auth' });
      }
    for (const t of TERMINATORS) {
      cases.push({ path: `/api/owner/${t}`, expect: 'auth' });
      cases.push({ path: `/api/owner/messages${t}`, method: 'POST', expect: 'auth' });
      cases.push({ path: `/api/owner/approvals/${ANY_ID}${t}`, method: 'POST', expect: 'auth' });
      cases.push({ path: `/api/owner/me${t}`, method: 'PATCH', expect: 'auth' });
    }
    await check(cases, () => owner);
  });

  it('double slashes, trailing slashes and mixed case', async () => {
    await check(
      [
        { path: '/api/owner', expect: 'auth' },
        { path: '/api/owner/', expect: 'auth' },
        { path: '/api/owner//me', expect: 'auth' },
        { path: '/api/owner/me/', expect: 'auth' },
        { path: '/api/owner/units//', expect: 'auth' },
        { path: `/api/owner/units/${ANY_ID}/`, expect: 'auth' },
        { path: '/api/owner/approvals/', expect: 'auth' },
        { path: '/api/owner//approvals', expect: 'auth' },
        { path: '/api/owner/budgets/', expect: 'auth' },
        { path: '/api/owner/ME', expect: 'auth' },
        { path: '/api/owner/Approvals', expect: 'auth' },
        { path: '/api/owner/MESSAGES/', expect: 'auth' },
        // Outside the /api/owner/ prefix: no route answers, whoever asks.
        { path: '//api/owner/me', expect: 'no-route' },
        { path: '/api//owner/me', expect: 'no-route' },
        { path: '/API/owner/me', expect: 'no-route' },
        { path: '/api/Owner/me', expect: 'no-route' },
        { path: '/api/OWNER/approvals', expect: 'no-route' },
      ],
      () => owner,
    );
  });

  it('prefix tricks: dot segments, encoded slashes and backslashes, look-alike prefixes', async () => {
    await check(
      [
        // Dot segments are resolved by the URL parser before routing, into another guarded route.
        { path: '/api/owner/../owner/me', expect: 'auth' },
        { path: '/api/owner/%2e%2e/owner/me', expect: 'auth' },
        { path: '/api/owner/units/%2E%2E/me', expect: 'auth' },
        { path: '/api/x/../owner/me', expect: 'auth' },
        { path: '/api/owner\\me', expect: 'auth' },
        // Encoded separators stay inside the segment and inside the guarded prefix.
        { path: '/api/owner/..%2Fme', expect: 'auth' },
        { path: '/api/owner/approvals%2F..%2Fme', expect: 'auth' },
        { path: '/api/owner/messages%2F', expect: 'auth' },
        { path: '/api/owner/me%00', expect: 'auth' },
        { path: '/api/owner/me%20', expect: 'auth' },
        { path: '/api/owner/me;x', expect: 'auth' },
        { path: '/api/owner/me?x=/../../auth/owner/exchange', expect: 'auth' },
        // Look-alike prefixes and encoded slashes before the prefix match no route.
        { path: '/api/owner%2Fme', expect: 'no-route' },
        { path: '/api%2Fowner/me', expect: 'no-route' },
        { path: '/api/owner%5Cme', expect: 'no-route' },
        { path: '/api/owner%5C..%5Cme', expect: 'no-route' },
        { path: '/api/owners/me', expect: 'no-route' },
        { path: '/api/ownerX/me', expect: 'no-route' },
        { path: '/api/owner;/me', expect: 'no-route' },
        { path: '/api/owner%0A/me', expect: 'no-route' },
        { path: '/api/auth/owner/..%2F..%2Fowner%2Fme', expect: 'no-route' },
      ],
      () => owner,
    );
  });
});

describe('staff API: per-route requireStaff holds for crafted paths', () => {
  const routes = () => [
    '/api/staff/overview',
    '/api/staff/today',
    '/api/staff/staff',
    '/api/staff/settings',
    `/api/staff/owners/${ownerId}`,
  ];

  it('the plain routes need a staff token', async () => {
    await check(
      [
        ...routes().map((path) => ({ path, expect: 'auth' as const })),
        { path: '/api/staff/settings', method: 'PATCH', expect: 'auth' },
        { path: '/api/staff/owners', method: 'POST', expect: 'auth' },
        { path: '/api/auth/staff/me', expect: 'auth' },
      ],
      () => admin,
    );
  });

  it('encoded line terminators reach either the guarded route or no route', async () => {
    const cases: Case[] = [];
    for (const t of TERMINATORS) {
      // In a parameter the terminator is part of the id: the route matches, so its guard runs.
      cases.push({ path: `/api/staff/owners/${ownerId}${t}`, expect: 'auth' });
      cases.push({ path: `/api/staff/owners/${t}`, expect: 'auth' });
      cases.push({ path: `/api/staff/staff/${ANY_ID}${t}`, method: 'PATCH', expect: 'auth' });
      // In a fixed segment nothing matches: a 404 for everyone, the right token included.
      for (const path of ['/api/staff/overview', '/api/staff/today', '/api/staff/settings'])
        cases.push({ path: `${path}${t}`, expect: 'no-route' });
      cases.push({ path: `/api/staff/settings${t}`, method: 'PATCH', expect: 'no-route' });
      cases.push({ path: `/api/auth/staff/me${t}`, expect: 'no-route' });
    }
    await check(cases, () => admin);
  });

  it('double slashes, trailing slashes, mixed case and prefix tricks', async () => {
    await check(
      [
        { path: '/api/staff//overview', expect: 'no-route' },
        { path: '//api/staff/overview', expect: 'no-route' },
        { path: '/api//staff/overview', expect: 'no-route' },
        { path: '/api/staff/overview/', expect: 'no-route' },
        { path: `/api/staff/owners/${ownerId}/`, expect: 'no-route' },
        { path: `/api/staff/owners//${ownerId}`, expect: 'no-route' },
        { path: '/api/staff/OVERVIEW', expect: 'no-route' },
        { path: '/API/staff/overview', expect: 'no-route' },
        { path: '/api/Staff/today', expect: 'no-route' },
        { path: `/api/staff/Owners/${ownerId}`, expect: 'no-route' },
        // Dot segments resolve before routing into another guarded staff route.
        { path: '/api/staff/x/../overview', expect: 'auth' },
        { path: '/api/owner/../staff/overview', expect: 'auth' },
        { path: '/api/auth/staff/../../staff/today', expect: 'auth' },
        { path: '/api/owner/%2e%2e/staff/today', expect: 'auth' },
        { path: '/api/owner\\..\\staff\\overview', expect: 'auth' },
        // From the owner prefix, an encoded climb stays under the owner guard.
        { path: '/api/owner/..%2Fstaff%2Foverview', expect: 'auth' },
        { path: '/api/owner/%2E%2E%2Fstaff/overview', expect: 'auth' },
        // Elsewhere it matches no route.
        { path: '/api/staff%2Foverview', expect: 'no-route' },
        { path: '/api/staff/x%2F..%2Foverview', expect: 'no-route' },
        { path: '/api/staff%5Coverview', expect: 'no-route' },
        { path: '/api/auth/staff/..%2F..%2Fstaff%2Ftoday', expect: 'no-route' },
        { path: '/api/auth/owner/..%2F..%2Fstaff%2Ftoday', expect: 'no-route' },
        { path: '/api/staffX/today', expect: 'no-route' },
      ],
      () => admin,
    );
  });

  it('a static file path cannot be used to reach the API', async () => {
    // /app/* and /assets/* go to the asset binding, which the tests do not have: a plain 404.
    for (const path of ['/app/..%2Fapi%2Fstaff%2Foverview', '/assets/..%2Fapi%2Fowner%2Fme']) {
      const res = await w.request(path);
      expect(res.status, path).toBe(404);
    }
  });
});

describe('tokens work only on their own side', () => {
  it('owner routes refuse staff tokens, whatever the role and the path shape', async () => {
    const paths = [
      '/api/owner/me',
      `/api/owner/units/${ANY_ID}`,
      '/api/owner/approvals',
      '/api/owner/budgets',
      '/api/owner/messages',
      '/api/owner/me%0A',
      '/api/owner/approvals%E2%80%A8',
      '/api/owner/messages/',
      '/api/owner//budgets',
      '/api/owner/ME',
    ];
    for (const token of [admin, viewer])
      for (const path of paths) {
        const res = await w.json<{ error: { code: string } }>(path, { token });
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('forbidden');
      }
    const post = await w.request('/api/owner/messages', {
      method: 'POST',
      token: admin,
      body: JSON.stringify({ subject: 'x', body: 'x' }),
    });
    expect(post.status).toBe(403);
  });

  it('staff routes refuse owner tokens, whatever the path shape', async () => {
    const paths = [
      '/api/staff/overview',
      '/api/staff/today',
      '/api/staff/staff',
      '/api/staff/settings',
      `/api/staff/owners/${ownerId}`,
      `/api/staff/owners/${ownerId}%0A`,
      `/api/staff/owners/${ownerId}%E2%80%A9`,
      '/api/staff/x/../settings',
      '/api/auth/staff/me',
    ];
    for (const path of paths) {
      const res = await w.json<{ error: { code: string } }>(path, { token: owner });
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('forbidden');
    }
    const patch = await w.request('/api/staff/settings', {
      method: 'PATCH',
      token: owner,
      body: JSON.stringify({}),
    });
    expect(patch.status).toBe(403);
  });

  it('a staff token without the authenticator step opens neither side', async () => {
    const preMfa = await w.staffToken('admin@vamar.test', { mfa: false });
    for (const path of ['/api/staff/overview', `/api/staff/owners/${ownerId}%0D`]) {
      const res = await w.json<{ error: { code: string } }>(path, { token: preMfa });
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('totp_required');
    }
    const res = await w.request('/api/owner/me%0A', { token: preMfa });
    expect(res.status).toBe(403);
  });
});

describe('the installed Hono applies wildcard middleware on every router', () => {
  const routers = [
    ['RegExpRouter', () => new RegExpRouter()],
    ['TrieRouter', () => new TrieRouter()],
  ] as const;

  function guarded(router: unknown) {
    return new Hono({ router: router as never })
      .use('/api/owner/*', async (c, next) => {
        if (!c.req.header('authorization')) return c.text('unauthorized', 401);
        await next();
      })
      .use('/admin/*', async (c, next) => {
        if (!c.req.header('authorization')) return c.text('unauthorized', 401);
        await next();
      })
      .get('/api/owner/me', (c) => c.text('secret'))
      .get('/api/owner/units/:id', (c) => c.text('secret'))
      .get('/admin*', (c) => c.text('secret'))
      .notFound((c) => c.text('not found', 404));
  }

  for (const [name, make] of routers)
    it(`${name}: line terminators, and /admin* under /admin/*, meet the guard`, async () => {
      const probe = guarded(make());
      const paths = [
        '/api/owner/me',
        `/api/owner/units/${ANY_ID}`,
        '/admin/x',
        ...TERMINATORS.flatMap((t) => [`/api/owner/me${t}`, `/api/owner/${t}`, `/admin/x${t}`]),
      ];
      const unguarded: string[] = [];
      for (const path of paths) {
        const res = await probe.request(`http://test${path}`);
        if (res.status !== 401) unguarded.push(`${path} -> ${res.status}`);
      }
      expect(unguarded).toEqual([]);
    });

  it('this app runs on a router that applies them (SmartRouter picks it at the first request)', async () => {
    await app.request('http://test/healthz', {}, { APP_ENV: 'test' } as never);
    const router = app.router as unknown as { activeRouter?: { name: string } };
    expect(['RegExpRouter', 'TrieRouter']).toContain(router.activeRouter?.name);
  });
});
