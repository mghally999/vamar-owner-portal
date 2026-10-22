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
