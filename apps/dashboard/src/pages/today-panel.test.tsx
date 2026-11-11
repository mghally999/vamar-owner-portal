// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from '@/lib/theme';
import { apiError, type ApiCall } from '@/test/api';
import { building, contractRow, disputeRow, overview, page } from '@/test/fixtures';
import { reportSummary, v2Routes, workOrderRow } from '@/test/fixtures-v2';
import { staffToday, staffTodayClear } from '@/test/fixtures-today';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  applyTheme('default');
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/overview': overview(),
    'GET /api/staff/reports/summary': reportSummary(),
    'GET /api/staff/today': staffToday(),
    'GET /api/staff/buildings': { items: [building()] },
    ...extra,
  });

/** The link's target as path plus search parameters. */
function target(link: HTMLElement) {
  const url = new URL(link.getAttribute('href') ?? '', 'http://x');
  return { path: url.pathname, search: Object.fromEntries(url.searchParams) };
}

const tile = (panel: HTMLElement, name: RegExp) => within(panel).getByRole('link', { name });

describe('TodayPanel', () => {
  it('sits at the top of the Overview, one tile per job, each linking to its filtered list', async () => {
    const { api } = await renderApp('/', { routes: routes() });
    const panel = await screen.findByRole('region', { name: 'Today' });
    await within(panel).findByText('Cheques due today');
    expect(api.to('GET', '/api/staff/today')).toHaveLength(1);
    // Above the period bar: the first thing on the page.
    const periodChip = screen.getByRole('radio', { name: 'This month' });
    expect(
      panel.compareDocumentPosition(periodChip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const dueToday = tile(panel, /Cheques due today/);
    expect(within(dueToday).getByText('9')).toBeTruthy();
    expect(within(dueToday).getByText('155,248')).toBeTruthy();
    expect(target(dueToday)).toEqual({
      path: '/cheques',
      search: { from: '2026-10-07', to: '2026-10-07', status: 'upcoming,deposited' },
    });
    expect(target(tile(panel, /next 3 days/))).toEqual({
      path: '/cheques',
      search: { from: '2026-10-08', to: '2026-10-10', status: 'upcoming,deposited' },
    });
    const bounced = tile(panel, /Bounced cheques with no case yet/);
    expect(within(bounced).getByText('237,000')).toBeTruthy();
    expect(target(bounced)).toEqual({
      path: '/cheques',
      search: { status: 'bounced', from: '2026-07-07', to: '2026-09-07' },
    });
    const hearings = tile(panel, /Hearings in the next 7 days/);
    expect(within(hearings).getByText(/^Next /)).toBeTruthy();
    expect(target(hearings)).toEqual({
      path: '/disputes',
      search: { hearingFrom: '2026-10-07', hearingTo: '2026-10-14' },
    });
    const overdue = tile(panel, /past their scheduled date/);
    expect(within(overdue).getByText(/^Oldest /)).toBeTruthy();
    expect(target(overdue)).toEqual({ path: '/work-orders', search: { overdue: '1' } });
    // No drafts: the tile still links to the drafts queue, without a date span.
    const drafts = tile(panel, /Expense drafts waiting for review/);
    expect(within(drafts).getByText('0')).toBeTruthy();
    expect(target(drafts)).toEqual({ path: '/expenses', search: { status: 'draft' } });
    expect(target(tile(panel, /without a renewal draft/))).toEqual({
      path: '/contracts',
      search: { endingWithinDays: '30', withoutRenewal: '1' },
    });
    expect(within(panel).queryByText('Nothing needs action today.')).toBeNull();
  });

  it('says so when nothing needs action, and offers a retry when the request fails', async () => {
    let fail = true;
    const { api, user } = await renderApp('/', {
      routes: routes({
        'GET /api/staff/today': () => (fail ? apiError(500, 'internal') : staffTodayClear()),
      }),
    });
    const panel = await screen.findByRole('region', { name: 'Today' });
    expect(await within(panel).findByText('The list for today could not be loaded.')).toBeTruthy();
    // The rest of the Overview still shows.
    expect(screen.getAllByText('Expected rent').length).toBeGreaterThan(0);
    fail = false;
    await user.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await within(panel).findByText('Nothing needs action today.')).toBeTruthy();
    expect(api.to('GET', '/api/staff/today')).toHaveLength(2);
  });

  it('follows a tile to the work orders with the overdue filter, which the chip removes', async () => {
    const { api, router, user } = await renderApp('/', {
      routes: routes({
        'GET /api/staff/work-orders': (c: ApiCall) =>
          page(
            c.query['overdue'] === '1'
              ? [workOrderRow()]
              : [workOrderRow(), workOrderRow({ id: 'wo-2' })],
          ),
      }),
    });
    const panel = await screen.findByRole('region', { name: 'Today' });
    await user.click(await within(panel).findByRole('link', { name: /past their scheduled date/ }));
    // The list page loads lazily: its chip shows once it has rendered with the filter.
    const chip = await screen.findByRole('button', {
      name: 'Remove filter: Past the scheduled date',
    });
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/work-orders').query['overdue']).toBe('1');
    });
    await user.click(chip);
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/work-orders').query['overdue']).toBeUndefined();
    });
    expect(router.state.location.search).not.toHaveProperty('overdue');
  });

  it('opens disputes with the hearing window and contracts with the renewal filter', async () => {
    const disputes = await renderApp('/disputes?hearingFrom=2026-10-07&hearingTo=2026-10-14', {
      routes: routes({
        'GET /api/staff/disputes': {
          items: [{ chequeNos: [], ...disputeRow() }],
          nextCursor: null,
        },
      }),
    });
    await vi.waitFor(() => {
      expect(disputes.api.last('GET', '/api/staff/disputes').query).toMatchObject({
        hearingFrom: '2026-10-07',
        hearingTo: '2026-10-14',
      });
    });
    expect(screen.getByRole('button', { name: /^Remove filter: Hearing / })).toBeTruthy();
    cleanup();

    const contracts = await renderApp('/contracts?endingWithinDays=30&withoutRenewal=1', {
      routes: routes({ 'GET /api/staff/contracts': page([contractRow()]) }),
    });
    await vi.waitFor(() => {
      expect(contracts.api.last('GET', '/api/staff/contracts').query).toMatchObject({
        endingWithinDays: '30',
        withoutRenewal: '1',
      });
    });
    const box = screen.getByRole('checkbox', { name: 'Contracts ending within 30 days' });
    expect((box as HTMLInputElement).checked).toBe(true);
    await contracts.user.click(
      screen.getByRole('button', { name: 'Remove filter: No renewal drafted' }),
    );
    await vi.waitFor(() => {
      expect(
        contracts.api.last('GET', '/api/staff/contracts').query['withoutRenewal'],
      ).toBeUndefined();
    });
  });

  it('reads right to left in Arabic and has no accessibility violations', async () => {
    await renderApp('/', { lang: 'ar', routes: routes() });
    const panel = await screen.findByRole('region', { name: 'اليوم' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(await within(panel).findByText('شيكات مستحقة اليوم')).toBeTruthy();
    expect(within(panel).getByText('عقود تنتهي خلال 30 يوماً دون مسودة تجديد')).toBeTruthy();
    expect(within(tile(panel, /شيكات مستحقة اليوم/)).getAllByText('درهم').length).toBe(1);
    // jsdom has no layout, so contrast is checked in the browser suite, not here.
    const result = await axe.run(panel, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it('uses theme tokens only, so the white theme recolours it, and lets tiles shrink on a phone', async () => {
    applyTheme('white');
    await renderApp('/', { routes: routes() });
    const panel = await screen.findByRole('region', { name: 'Today' });
    await within(panel).findByText('Cheques due today');
    expect(document.documentElement.dataset['theme']).toBe('white');
    const classes = [...panel.querySelectorAll('[class]')].map((e) => e.getAttribute('class'));
    // Fixed palette colours would ignore the theme; only the token utilities may colour the panel.
    const raw =
      /\b(?:bg|text|border)-(?:white|black|(?:slate|gray|zinc|red|green|blue|amber)-\d+)\b/;
    expect(classes.filter((c) => c && raw.test(c))).toEqual([]);
    // Two columns at phone width: each tile and its text may shrink and wrap instead of
    // pushing the page sideways at 390 px.
    const grid = panel.querySelector('ul');
    expect(grid?.className).toContain('grid-cols-2');
    for (const link of within(panel).getAllByRole('link')) {
      expect(link.className).toContain('min-w-0');
      expect(link.closest('li')?.className).toContain('min-w-0');
    }
    const result = await axe.run(panel, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
