/**
 * Owner web app at /app: loads in Arabic right to left, is installable (manifest, icons, service
 * worker), has no console errors and no serious axe violations on the sign-in screen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('owner web app opens in Arabic and is installable', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/app/');
  await expect(page.getByText('تسجيل الدخول').first()).toBeVisible({ timeout: 30_000 });
  const root = page.locator('body > *').first();
  expect(await root.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/app/manifest.json');
  const manifest = (await (await request.get('/app/manifest.json')).json()) as {
    start_url: string;
    display: string;
    icons: { src: string }[];
  };
  expect(manifest).toMatchObject({ start_url: '/app/', display: 'standalone' });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/app/');

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 80) ?? ''}`)).toEqual([]);

  expect(errors).toEqual([]);
});

test('an old bundle name is a 404, not the app page', async ({ request }) => {
  const r = await request.get('/app/_expo/static/js/web/entry-0000000000.js');
  expect(r.status()).toBe(404);
});
