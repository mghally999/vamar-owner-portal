/**
 * Screenshots of every dashboard page in Arabic and English, at desktop and phone width, for the
 * docs and the demo. One signed-in page per language and width; each screenshot is its own test,
 * so the time limit applies per page and a failure names the page that did not render.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const OUT = process.env['SCREENSHOT_DIR'] ?? '../../demo/screenshots/dashboard';
/** 'default' or 'white'; the file names carry the theme when it is not the default. */
const THEME = process.env['SCREENSHOT_THEME'] ?? 'default';
const SUFFIX = THEME === 'default' ? '' : `-${THEME}`;
mkdirSync(OUT, { recursive: true });

const PAGES: { name: string; path: string }[] = [
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
  // v2
  { name: 'calendar', path: '/calendar' },
  { name: 'vendors', path: '/vendors' },
  { name: 'expense-categories', path: '/expense-categories' },
  { name: 'holidays', path: '/holidays' },
  { name: 'settings', path: '/settings' },
  { name: 'overview-year', path: '/?preset=this_year&compare=1' },
  { name: 'expenses', path: '/expenses?preset=this_year' },
  { name: 'expense-drafts', path: '/expenses?status=draft' },
  { name: 'expense-new', path: '/expenses/new' },
  { name: 'expense-rules', path: '/expenses/rules' },
  { name: 'work-orders', path: '/work-orders' },
  { name: 'work-order-new', path: '/work-orders/new' },
  { name: 'reports', path: '/reports?preset=this_year&compare=1' },
];

/** Detail pages: open the list, then follow the first visible link of each selector in turn. */
const DETAILS: { name: string; list: string; links: string[] }[] = [
  { name: 'building-detail', list: '/buildings', links: ['a[href^="/buildings/"]'] },
  // v2: the unit record behind the first unit of that building
  {
    name: 'unit-detail',
    list: '/buildings',
    links: ['a[href^="/buildings/"]', 'a[href^="/units/"]'],
  },
  {
    name: 'contract-detail',
    list: '/contracts',
    links: ['a[href^="/contracts/"]:not([href$="/new"])'],
  },
  { name: 'cheque-detail', list: '/cheques', links: ['a[href^="/cheques/"]'] },
  { name: 'owner-detail', list: '/owners', links: ['a[href^="/owners/"]'] },
  { name: 'dispute-detail', list: '/disputes', links: ['a[href^="/disputes/"]'] },
  // v2: a posted expense with its invoice and a work order with photos
  {
    name: 'expense-detail',
    list: '/expenses?preset=this_year&status=posted',
    links: ['a[href^="/expenses/"]:not([href$="/new"]):not([href$="/rules"])'],
  },
  {
    name: 'work-order-detail',
    list: '/work-orders',
    links: ['a[href^="/work-orders/"]:not([href$="/new"])'],
  },
];

/**
 * Waits until the page has rendered its data: the page heading is shown and no loading skeleton
 * is left. The app keeps requests going (session checks, counts), so the network never goes idle
 * and is not a signal to wait for.
 */
async function settle(page: Page) {
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(main.locator('.skeleton, [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  // Let entry transitions finish so the picture is not caught mid-fade.
  await page.waitForTimeout(300);
}

async function shoot(page: Page, name: string, lang: string, width: number, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}-${lang}-${width}${SUFFIX}.png`, fullPage });
}

for (const lang of ['ar', 'en'] as const) {
  for (const width of [1440, 390]) {
    test.describe(`screenshots ${lang} @${width}`, () => {
      test.describe.configure({ mode: 'serial' });
      let page: Page;

      test.beforeAll(async ({ browser }, testInfo) => {
        // The project's own options (base URL, Arabic locale, device) on a page shared by the tests.
        const { baseURL, locale, userAgent, deviceScaleFactor } = testInfo.project.use;
        page = await browser.newPage({
          ...(baseURL ? { baseURL } : {}),
          ...(locale ? { locale } : {}),
          ...(userAgent ? { userAgent } : {}),
          ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
          viewport: { width, height: width === 1440 ? 900 : 844 },
        });
        await page.addInitScript(
          ([theme, l]) => {
            localStorage.setItem('vamar.theme', theme);
            localStorage.setItem('vamar.lang', l);
          },
          [THEME, lang] as const,
        );
      });

      test.afterAll(async () => {
        await page.close();
      });

      test('login', async () => {
        await page.goto('/login');
        await expect(page.getByRole('button', { name: /تسجيل الدخول|Sign in/ })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        // The sign-in page uses only colours both palettes share: one picture, in the default run.
        if (THEME === 'default') await shoot(page, 'login', lang, width);
        await login(page, 'admin', lang);
      });

      for (const p of PAGES) {
        test(p.name, async () => {
          await page.goto(p.path);
          await settle(page);
          await shoot(page, p.name, lang, width);
        });
      }

      for (const d of DETAILS) {
        test(d.name, async () => {
          await page.goto(d.list);
          for (const selector of d.links) {
            await settle(page);
            const from = new URL(page.url()).pathname;
            await page.locator(selector).filter({ visible: true }).first().click();
            // The list's own heading is still on screen until the route changes.
            await page.waitForURL((u) => u.pathname !== from);
          }
          await settle(page);
          await shoot(page, d.name, lang, width);
        });
      }

      // Ctrl+K search with a case number typed; the palette loads on first use.
      test('search', async () => {
        await page.goto('/');
        await settle(page);
        await page.keyboard.press('Control+K');
        const input = page.getByRole('dialog').getByRole('combobox');
        await expect(input).toBeVisible();
        await input.fill('D-20');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
        await shoot(page, 'search', lang, width, false);
      });
    });
  }
}
