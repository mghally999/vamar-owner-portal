import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { login } from './helpers';

const OUT = process.env['SCREENSHOT_DIR'] ?? '../../demo/screenshots/dashboard';
/** 'default' or 'white'; the file names carry the theme when it is not the default. */
const THEME = process.env['SCREENSHOT_THEME'] ?? 'default';
const SUFFIX = THEME === 'default' ? '' : `-${THEME}`;
mkdirSync(OUT, { recursive: true });

const PAGES: { name: string; path: string; settle?: (page: Page) => Promise<void> }[] = [
  { name: 'overview', path: '/' },
  { name: 'owners', path: '/owners' },
  { name: 'buildings', path: '/buildings' },
  { name: 'contracts', path: '/contracts' },
  { name: 'contract-new', path: '/contracts/new' },
  { name: 'cheques', path: '/cheques' },
  { name: 'disputes', path: '/disputes' },
  { name: 'staff', path: '/staff' },
  { name: 'audit', path: '/audit' },
  { name: 'import', path: '/import' },
];

for (const lang of ['ar', 'en'] as const) {
  for (const width of [1440, 390]) {
    test(`screenshots ${lang} @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.addInitScript((theme) => {
        localStorage.setItem('vamar.theme', theme);
      }, THEME);
      await page.goto('/login');
      await page.evaluate((l) => {
        localStorage.setItem('vamar.lang', l);
      }, lang);
      await page.goto('/login');
      await page.screenshot({ path: `${OUT}/login-${lang}-${width}${SUFFIX}.png`, fullPage: true });
      await login(page, 'admin', lang);
      for (const p of PAGES) {
        await page.goto(p.path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${p.name}-${lang}-${width}${SUFFIX}.png`, fullPage: true });
      }
      // Detail pages: first building, first contract, first cheque, first owner
      await page.goto('/buildings');
      await page.locator('a[href^="/buildings/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: `${OUT}/building-detail-${lang}-${width}${SUFFIX}.png`,
        fullPage: true,
      });
      await page.goto('/contracts');
      await page.locator('a[href^="/contracts/"]:not([href$="/new"])').first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: `${OUT}/contract-detail-${lang}-${width}${SUFFIX}.png`,
        fullPage: true,
      });
      await page.goto('/cheques');
      await page.locator('a[href^="/cheques/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${OUT}/cheque-detail-${lang}-${width}${SUFFIX}.png`, fullPage: true });
      await page.goto('/owners');
      await page.locator('a[href^="/owners/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${OUT}/owner-detail-${lang}-${width}${SUFFIX}.png`, fullPage: true });
      await page.goto('/disputes');
      await page.locator('a[href^="/disputes/"]').first().click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: `${OUT}/dispute-detail-${lang}-${width}${SUFFIX}.png`,
        fullPage: true,
      });
    });
  }
}
