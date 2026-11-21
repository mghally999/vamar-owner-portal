/**
 * Below 768 px ResponsiveTable turns rows into cards (styles.css). Their row link and checkbox
 * must be tap targets of at least 24 px (WCAG 2.2 target size); the layout sweep measured 22 px
 * links and 19 px checkboxes before this rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));

function rule(selector: string): string {
  const at = phone.indexOf(`${selector} {`);
  if (at < 0) return '';
  return phone.slice(at, phone.indexOf('}', at));
}

describe('card-table CSS on phones', () => {
  it('gives row links and row checkboxes a 24 px tap target', () => {
    expect(rule('table.card-table td a')).toMatch(/min-height:\s*24px/);
    expect(rule("table.card-table td input[type='checkbox']")).toMatch(/height:\s*24px/);
  });
});
