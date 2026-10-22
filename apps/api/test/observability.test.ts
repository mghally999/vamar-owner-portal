/**
 * Request ids, access logs, error reports and the staging environment.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cspConnectSrc, isDeployed, validateEnv } from '../src/config.js';
import { buildSentryEvent, reportError, scrub } from '../src/util/report.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

describe('observability', () => {
  it('every response carries a request id and API calls write one JSON access line', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const r = await w.request('/api/owner/me');
      const id = r.headers.get('x-request-id');
      expect(id).toBeTruthy();
      const line = spy.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.includes('"event":"http"') && l.includes(id ?? '-'));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line ?? '{}') as Record<string, unknown>;
      expect(parsed['status']).toBe(401);
      expect(parsed['route']).toBe('/api/owner/*');
      expect(JSON.stringify(parsed)).not.toContain('authorization');
    } finally {
      spy.mockRestore();
    }
  });

  it('error reports mask personal data and carry environment and release', () => {
    expect(scrub('owner +971500000001 failed for khalid@example.com')).toBe(
      'owner ***001 failed for k***@example.com',
    );
    const event = buildSentryEvent(
      { APP_ENV: 'staging', RELEASE: 'abc1234' },
      new Error('duplicate key for +971 50 000 0002'),
      { source: 'request', route: '/api/staff/owners', method: 'POST', requestId: 'r1' },
    );
    expect(event.environment).toBe('staging');
    expect(event.release).toBe('abc1234');
    expect(event.transaction).toBe('POST /api/staff/owners');
    expect(event.exception.values[0]?.value).toBe('duplicate key for ***002');
    expect(event.tags.request_id).toBe('r1');
  });

  it('sends to Sentry only when a DSN is configured', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((url: string) => {
      calls.push(url);
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await reportError({ ...w.env, APP_ENV: 'staging' }, new Error('x'), { source: 'cron' });
      expect(calls).toHaveLength(0);
      await reportError(
        { ...w.env, APP_ENV: 'staging', SENTRY_DSN: 'https://key123@o1.ingest.sentry.io/42' },
        new Error('x'),
        { source: 'cron' },
      );
      expect(calls).toEqual(['https://o1.ingest.sentry.io/api/42/envelope/']);
    } finally {
      globalThis.fetch = original;
      err.mockRestore();
    }
  });

  it('staging behaves like production for security checks', () => {
    expect(isDeployed({ APP_ENV: 'staging' })).toBe(true);
    expect(cspConnectSrc({ APP_ENV: 'staging' })).not.toContain('http://localhost:9099');
    const { TEST_DB: _db, ...rest } = w.env;
    expect(validateEnv({ ...rest, APP_ENV: 'staging' })).toContain(
      'FIREBASE_AUTH_EMULATOR_HOST must not be set in production',
    );
  });
});
