/**
 * Accessibility pass with axe-core over the main dashboard pages in Arabic (RTL) and English.
 * Fails on any serious or critical violation (contrast, labels, roles, landmarks).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const PAGES = [
  '/',
  '/owners',
  '/buildings',
  '/contracts',
  '/contracts/new',
  '/cheques',
  '/disputes',
  '/import',
  '/staff',
  '/audit',
];

for (const lang of ['ar', 'en'] as const) {
  test(`no serious axe violations (${lang})`, async ({ page }) => {
    await login(page, 'admin', lang);
    const report: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      for (const v of results.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          const sample = v.nodes
            .slice(0, 3)
            .map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 90)}`)
            .join(' | ');
          report.push(
            `${path}: [${v.impact}] ${v.id} (${v.nodes.length} nodes) ${v.help} -> ${sample}`,
          );
        }
      }
    }
    expect(report, report.join('\n')).toEqual([]);
  });
}
