/**
 * The download page puts the right option first for the phone that opens it, and the version
 * endpoint tells the app whether it must or may update.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectDevice } from '../src/download.js';
import { createWorld, type TestWorld } from './harness.js';

let w: TestWorld;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

describe('download page', () => {
  it('detects the device from the user agent', () => {
    expect(detectDevice(ANDROID)).toBe('android');
    expect(detectDevice(IPHONE)).toBe('ios');
    expect(detectDevice(DESKTOP)).toBe('desktop');
    expect(detectDevice(undefined)).toBe('desktop');
  });

  it('puts the matching option first, in Arabic, with no script', async () => {
    for (const [ua, first] of [
      [ANDROID, 'أندرويد'],
      [IPHONE, 'آيفون'],
      [DESKTOP, 'من الكمبيوتر'],
    ] as const) {
      const r = await w.request('/download', { headers: { 'user-agent': ua } });
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain('dir="rtl"');
      expect(html).not.toContain('<script');
      const firstHeading = /<h2>([^<]+)<\/h2>/.exec(html)?.[1];
      expect(firstHeading).toBe(first);
      // The APK is built for 64-bit ARM phones only; the page says so in both languages.
      expect(html).toContain('Android phones only (64-bit ARM)');
      expect(html).toContain('لهواتف أندرويد فقط');
    }
  });
});

describe('app version', () => {
  it('reports latest and minimum versions and where to download', async () => {
    const r = await w.json<{
      latestVersion: string;
      minimumVersion: string;
      downloadUrl: string;
      apkUrl: string;
    }>('/api/app/version');
    expect(r.status).toBe(200);
    expect(r.body.latestVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.body.minimumVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.body.downloadUrl).toBe('http://test/download');
    expect(r.body.apkUrl).toBe('http://test/download/vamar-owner-app.apk');
  });
});

describe('owner web app at /app', () => {
  it('serves files as they are and the app shell for in-app routes, with a reCAPTCHA-only CSP', async () => {
    const seen: string[] = [];
    const assets = {
      fetch: (input: Request | string) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        seen.push(url.pathname);
        return Promise.resolve(new Response(`asset ${url.pathname}`, { status: 200 }));
      },
    } as unknown as Fetcher;
    const env = { ...w.env, ASSETS: assets };
    const { app } = await import('../src/app.js');

    const redirect = await app.request('http://test/app', {}, env, w.ctx);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/app/');

    const route = await app.request('http://test/app/cheque/123', {}, env, w.ctx);
    expect(await route.text()).toBe('asset /app/index.html');
    expect(route.headers.get('cache-control')).toBe('no-cache');
    const csp = route.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://www.google.com/recaptcha/');
    expect(csp).toContain("frame-ancestors 'none'");

    const file = await app.request('http://test/app/manifest.json', {}, env, w.ctx);
    expect(await file.text()).toBe('asset /app/manifest.json');
    expect(seen).toEqual(['/app/index.html', '/app/manifest.json']);

    // The dashboard keeps the strict policy without third-party scripts.
    const api = await w.request('/api/owner/me');
    expect(api.headers.get('content-security-policy')).not.toContain('recaptcha');
  });
});

describe('dashboard bundles at /assets', () => {
  it('a missing bundle is a 404 that is never cached; a real one keeps its year-long cache', async () => {
    // The asset layer answers a missing file with the dashboard's index.html (SPA fallback).
    const assets = {
      fetch: (input: Request | string) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        return Promise.resolve(
          url.pathname === '/assets/index-abc123.js'
            ? new Response('console.log(1)', {
                status: 200,
                headers: { 'content-type': 'text/javascript' },
              })
            : new Response('<!doctype html>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
              }),
        );
      },
    } as unknown as Fetcher;
    const env = { ...w.env, ASSETS: assets };
    const { app } = await import('../src/app.js');

    const missing = await app.request('http://test/assets/index-old999.js', {}, env, w.ctx);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');

    const real = await app.request('http://test/assets/index-abc123.js', {}, env, w.ctx);
    expect(real.status).toBe(200);
    expect(await real.text()).toBe('console.log(1)');
    expect(real.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(real.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
