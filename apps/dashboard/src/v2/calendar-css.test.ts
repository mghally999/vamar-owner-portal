/**
 * The list view's hidden column headers must not be parked off-screen on a physical side: on the
 * Arabic page FullCalendar's `left: -10000px` made the whole page scroll sideways. The layout
 * itself is checked in a real browser by e2e/journeys-staff.spec.ts (calendar journey).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./calendar.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at));
}

describe('calendar.css', () => {
  it('hides the list headers by clipping, overriding FullCalendar’s left: -10000px', () => {
    const body = rule('.vamar-calendar .fc .fc-list-table thead');
    expect(body).toMatch(/left:\s*auto/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/-\d{4,}px/);
  });
});
