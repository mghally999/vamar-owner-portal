/**
 * The deployed staging Worker, seen from outside without signing in (playwright.staging.config.ts).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const STAGING = process.env['STAGING_URL'];
test.skip(
  !STAGING,
  'STAGING_URL is not set: nothing to check. Set it to the staging Worker URL to run these tests.',
);

for (const theme of ['default', 'white'] as const) {
  for (const lang of ['ar', 'en'] as const) {
    test(`dashboard sign-in page, ${theme} theme, ${lang}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(
        (v) => {
          localStorage.setItem('vamar.theme', v.theme);
          localStorage.setItem('vamar.lang', v.lang);
        },
        { theme, lang },
      );
      await page.goto('/login');
      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      const dataTheme = await page.locator('html').getAttribute('data-theme');
      expect(dataTheme ?? 'default').toBe(theme);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = axe.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(serious.map((v) => v.id)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('health, readiness and the API refuse without a token, never cached', async ({ request }) => {
  const health = await request.get('/healthz');
  expect(await health.json()).toMatchObject({ ok: true, env: 'staging' });
  expect(await (await request.get('/readyz')).json()).toMatchObject({ ok: true, db: true });
  for (const path of ['/api/staff/overview', '/api/owner/home', '/api/staff/staff']) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(401);
    expect(r.headers()['cache-control']).toBe('no-store');
  }
  const r = await request.get('/api/owner/me', { headers: { authorization: 'Bearer forged' } });
  expect(r.status()).toBe(401);
});

test('security headers on the dashboard and the API', async ({ request }) => {
  for (const path of ['/', '/api/app/version', '/download']) {
    const h = (await request.get(path)).headers();
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['strict-transport-security'], path).toContain('max-age=');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
  }
});

test('a missing dashboard bundle is a 404 that is not cached', async ({ request }) => {
  const r = await request.get('/assets/index-does-not-exist.js');
  expect(r.status()).toBe(404);
  expect(r.headers()['cache-control']).toBe('no-store');
});

test('the download page puts the right option first for each phone', async ({ request }) => {
  const order = async (ua: string) => {
    const html = await (await request.get('/download', { headers: { 'user-agent': ua } })).text();
    return { apk: html.indexOf('vamar-owner-app.apk'), web: html.indexOf('href="/app"') };
  };
  const android = await order('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36');
  expect(android.apk).toBeLessThan(android.web);
  const iphone = await order(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1',
  );
  expect(iphone.web).toBeLessThan(iphone.apk);
});
