// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overview, page } from '@/test/fixtures';
import { searchHits, v2Routes } from '@/test/fixtures-v2';
import { renderApp } from '@/test/render';
import { formatDate } from '@vamar/shared';
import { messages, type MessageKey } from '@/lib/messages';
import { hitDetail, hitTarget } from './search-palette';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = v2Routes({
  'GET /api/staff/overview': overview(),
  'GET /api/staff/reports/summary': {
    preset: 'this_month',
    period: { from: '2026-10-01', to: '2026-10-31' },
    comparison: null,
    rent: {
      expectedFils: 0,
      collectedFils: 0,
      outstandingFils: 0,
      atRiskFils: 0,
      chequeCount: 0,
      bouncedCount: 0,
      collectionRatePct: 0,
    },
    expenses: { fixedFils: 0, variableFils: 0, totalFils: 0, vatFils: 0, count: 0 },
    netFils: 0,
    previous: null,
    change: null,
    buckets: [],
    byCategory: [],
    occupancy: { occupiedUnits: 0, totalUnits: 0, pct: 0 },
  },
  'GET /api/staff/owners': page([]),
  'GET /api/staff/search': { items: searchHits },
});

describe('SearchPalette', () => {
  it('opens with Ctrl+K, groups the hits, and opens the chosen page with the keyboard', async () => {
    const { api, router, user } = await renderApp('/', { routes });
    await screen.findByText('Expected rent');
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox', { name: 'Search' }), '000909');
    expect(await within(dialog).findByText('Cheque 000909 · Al Noor Tower 801')).toBeTruthy();
    expect(api.last('GET', '/api/staff/search').query).toEqual({ q: '000909' });
    const groups = within(dialog)
      .getAllByText(/^(Owners|Units|Cheques)$/)
      .map((n) => n.textContent);
    expect(groups).toEqual(['Owners', 'Units', 'Cheques']);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/units/unit-801');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the sidebar button, shows the empty line, and a click navigates', async () => {
    const { user } = await renderApp('/', {
      routes: { ...routes, 'GET /api/staff/search': { items: [] } },
    });
    await screen.findByText('Expected rent');
    await user.click(screen.getAllByRole('button', { name: /Search/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox', { name: 'Search' }), 'zzz');
    expect(await within(dialog).findByText('Nothing matches.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    const second = await renderApp('/', { routes });
    await screen.findByText('Expected rent');
    await second.user.keyboard('{Meta>}k{/Meta}');
    const d2 = await screen.findByRole('dialog');
    await second.user.type(within(d2).getByRole('combobox', { name: 'Search' }), 'ahmed');
    await second.user.click(await within(d2).findByRole('option', { name: /Ahmed Al Mansouri/ }));
    await vi.waitFor(() => {
      expect(second.router.state.location.pathname).toBe('/owners/own-1');
    });
  });

  it('shows statuses and dates in the page language, not the codes the API sends', () => {
    const base = { titleAr: '', titleEn: '', parentId: null, id: 'x' };
    const i18n = (lang: 'ar' | 'en') => ({
      t: (k: MessageKey) => messages[lang][k],
      pick: (ar: string, en: string) => (lang === 'ar' ? ar : en),
      date: (d: string) => formatDate(d as never, lang),
    });
    const dispute = { ...base, type: 'dispute' as const, detail: 'hearing_scheduled' };
    const cheque = { ...base, type: 'cheque' as const, detail: '2026-11-11 · deposited' };
    const expense = { ...base, type: 'expense' as const, detail: 'INV-7 · posted' };
    const owner = { ...base, type: 'owner' as const, detail: '+971500000001' };
    expect([dispute, cheque, expense, owner].map((h) => hitDetail(h, i18n('ar')))).toEqual([
      'جلسة محددة',
      `${formatDate('2026-11-11' as never, 'ar')} · مودَع`,
      'INV-7 · مرحَّل',
      '+971500000001',
    ]);
    expect(hitDetail(dispute, i18n('en'))).toBe('Hearing scheduled');
    expect(hitDetail({ ...expense, detail: ' · draft' }, i18n('en'))).toBe('Draft');
    // A code this build does not know is shown as sent rather than as a missing label.
    expect(hitDetail({ ...dispute, detail: 'archived' }, i18n('en'))).toBe('archived');
  });

  it('maps every hit type to a page', () => {
    const base = { titleAr: '', titleEn: '', detail: '', parentId: null };
    expect(hitTarget({ ...base, type: 'owner', id: 'o' })).toEqual({
      to: '/owners/$ownerId',
      params: { ownerId: 'o' },
    });
    expect(hitTarget({ ...base, type: 'building', id: 'b' })).toEqual({
      to: '/buildings/$buildingId',
      params: { buildingId: 'b' },
    });
    expect(hitTarget({ ...base, type: 'cheque', id: 'c' })).toEqual({
      to: '/cheques/$chequeId',
      params: { chequeId: 'c' },
    });
    expect(hitTarget({ ...base, type: 'dispute', id: 'd' })).toEqual({
      to: '/disputes/$disputeId',
      params: { disputeId: 'd' },
    });
    expect(hitTarget({ ...base, type: 'expense', id: 'e' })).toEqual({
      to: '/expenses/$expenseId',
      params: { expenseId: 'e' },
    });
    expect(hitTarget({ ...base, type: 'tenant', id: 't' })).toEqual({ to: '/contracts' });
  });
});
