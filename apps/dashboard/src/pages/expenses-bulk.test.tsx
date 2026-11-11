// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BULK_EXPENSES } from '@vamar/shared';
import { expenseBulkMessages, type ExpenseBulkMessageKey } from '@/lib/expense-bulk-messages';
import { apiError, type ApiCall } from '@/test/api';
import { building, buildingDetail, page } from '@/test/fixtures';
import { expenseRow, expenseTotals, v2Routes } from '@/test/fixtures-v2';
import { renderApp } from '@/test/render';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DRAFTS = [
  expenseRow({
    id: 'exp-d1',
    status: 'draft',
    reasonEn: 'Guard salaries October',
    reasonAr: 'رواتب الحراس أكتوبر',
    invoiceNo: null,
    invoiceDate: '2026-10-25',
    recurringRuleId: 'rule-1',
  }),
  expenseRow({
    id: 'exp-d2',
    status: 'draft',
    reasonEn: 'Water pump replaced',
    reasonAr: 'استبدال مضخة المياه',
    invoiceNo: 'PL-77',
    invoiceDate: '2026-10-20',
    approvalState: 'pending',
  }),
];
const POSTED = expenseRow({ id: 'exp-p1', reasonEn: 'Lift 2 repair' });
const VOID = expenseRow({ id: 'exp-v1', status: 'void', reasonEn: 'Wrong invoice' });

const routes = (rows = DRAFTS, extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': { items: [building()] },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'GET /api/staff/expenses': { ...page(rows), totals: expenseTotals() },
    ...extra,
  });

const bar = () => screen.getByRole('region', { name: 'Selected expenses' });
// The header checkbox and the phone-width one above the cards; only one shows at a time.
const selectAll = () => screen.getAllByRole('checkbox', { name: 'Select all on this page' })[0]!;

describe('expense bulk actions: drafts queue', () => {
  it('selects all drafts and posts them in one request with a note', async () => {
    const { api, user } = await renderApp('/expenses?status=draft', {
      role: 'editor',
      routes: routes(DRAFTS, {
        'POST /api/staff/expenses/bulk': (c: ApiCall) => ({
          updated: (c.body as { ids: string[] }).ids,
          unchanged: [],
          notified: 0,
        }),
      }),
    });
    await screen.findByText('Guard salaries October');
    expect(screen.queryByRole('region', { name: 'Selected expenses' })).toBeNull();
    await user.click(selectAll());
    expect(within(bar()).getByText('2 selected')).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'Post' })).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'Delete drafts' })).toBeTruthy();
    expect(within(bar()).queryByRole('button', { name: 'Hide from owners' })).toBeNull();

    await user.click(within(bar()).getByRole('button', { name: 'Post' }));
    const dialog = await screen.findByRole('dialog', { name: 'Post selected drafts (2)' });
    expect(
      within(dialog).getByText(/If any draft cannot be posted, nothing is posted/),
    ).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/Note/), 'Month end');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Expenses posted: 2.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/expenses/bulk').body).toEqual({
      ids: ['exp-d1', 'exp-d2'],
      action: 'post',
      note: 'Month end',
    });
    expect(screen.queryByRole('region', { name: 'Selected expenses' })).toBeNull();
  });

  it('lists every refused draft when nothing was posted, and deselects them', async () => {
    const { api, user } = await renderApp('/expenses?status=draft', {
      role: 'editor',
      routes: routes(DRAFTS, {
        'POST /api/staff/expenses/bulk': apiError(422, 'invalid_transition', 'refused', {
          rejected: [
            {
              id: 'exp-d2',
              invoiceNo: 'PL-77',
              reasonAr: 'استبدال مضخة المياه',
              reasonEn: 'Water pump replaced',
              status: 'draft',
              code: 'approval_required',
              reason: 'Waiting for the owners to approve this job',
            },
            {
              id: 'exp-gone',
              invoiceNo: null,
              reasonAr: null,
              reasonEn: null,
              status: null,
              code: 'not_found',
              reason: 'Expense not found',
            },
          ],
        }),
      }),
    });
    await screen.findByText('Guard salaries October');
    await user.click(screen.getByRole('checkbox', { name: /^Select Guard salaries October/ }));
    expect(selectAll()).toHaveProperty('indeterminate', true);
    await user.click(screen.getByRole('checkbox', { name: /^Select Water pump replaced/ }));
    expect(selectAll()).toHaveProperty('checked', true);
    await user.click(within(bar()).getByRole('button', { name: 'Delete drafts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete selected drafts (2)' });
    expect(
      within(dialog).getByText(/kept as discarded, so the rule does not make them again/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(
      await within(dialog).findByText(
        'Nothing was changed. These expenses cannot take this action:',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText('Water pump replaced')).toBeTruthy();
    expect(within(dialog).getByText('PL-77')).toBeTruthy();
    expect(within(dialog).getByText(/Waiting for the owners’ approval/)).toBeTruthy();
    // An id the server no longer knows is named by its id.
    expect(within(dialog).getByText('exp-gone')).toBeTruthy();
    expect(within(dialog).getByText('No longer exists')).toBeTruthy();
    expect(api.last('POST', '/api/staff/expenses/bulk').body).toEqual({
      ids: ['exp-d1', 'exp-d2'],
      action: 'discard',
    });

    await user.click(within(dialog).getByRole('button', { name: 'Deselect these and go back' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(within(bar()).getByText('1 selected')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /^Select Water pump replaced/ })).toHaveProperty(
      'checked',
      false,
    );
    await user.click(within(bar()).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Selected expenses' })).toBeNull();
  });

  it(`blocks more than ${String(MAX_BULK_EXPENSES)} expenses at once`, async () => {
    const many = Array.from({ length: MAX_BULK_EXPENSES + 1 }, (_, i) =>
      expenseRow({ id: `m-${String(i)}`, status: 'draft', reasonEn: `Draft ${String(i)}` }),
    );
    const { user } = await renderApp('/expenses?status=draft', { routes: routes(many) });
    await screen.findByText('Draft 0');
    await user.click(selectAll());
    expect(
      within(bar()).getByText(`Select at most ${String(MAX_BULK_EXPENSES)} expenses at a time.`),
    ).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'Post' })).toHaveProperty('disabled', true);
  });
});

describe('expense bulk actions: expense list', () => {
  it('admins hide posted expenses from owners; void rows cannot be selected', async () => {
    const { api, user } = await renderApp('/expenses', {
      routes: routes([...DRAFTS, POSTED, VOID], {
        'POST /api/staff/expenses/bulk': { updated: ['exp-p1'], unchanged: [], notified: 0 },
      }),
    });
    await screen.findByText('Lift 2 repair');
    expect(screen.queryByRole('checkbox', { name: /^Select Wrong invoice/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /^Select Lift 2 repair/ }));
    expect(within(bar()).queryByRole('button', { name: 'Post' })).toBeNull();
    expect(within(bar()).getByRole('button', { name: 'Show to owners' })).toBeTruthy();
    await user.click(within(bar()).getByRole('button', { name: 'Hide from owners' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Hide selected expenses from owners (1)',
    });
    expect(within(dialog).getByText(/no longer count in the owners’ totals/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Expenses hidden from owners: 1.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/expenses/bulk').body).toEqual({
      ids: ['exp-p1'],
      action: 'hide',
    });

    // A mixed selection offers both kinds; the server says which ones cannot take the action.
    await user.click(selectAll());
    expect(within(bar()).getByText('3 selected')).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'Post' })).toBeTruthy();
    expect(within(bar()).getByRole('button', { name: 'Show to owners' })).toBeTruthy();
    // Changing tab drops a selection made on another tab.
    await user.click(screen.getByRole('tab', { name: 'Posted' }));
    expect(screen.queryByRole('region', { name: 'Selected expenses' })).toBeNull();
  });

  it('editors select drafts only; viewers see no checkboxes', async () => {
    await renderApp('/expenses', { role: 'editor', routes: routes([...DRAFTS, POSTED]) });
    await screen.findByText('Lift 2 repair');
    expect(screen.queryByRole('checkbox', { name: /^Select Lift 2 repair/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /^Select Guard salaries October/ })).toBeTruthy();
    cleanup();

    await renderApp('/expenses', { role: 'viewer', routes: routes([...DRAFTS, POSTED]) });
    await screen.findByText('Lift 2 repair');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('works in Arabic, right to left, and the bar and dialog have no axe violations', async () => {
    const { user } = await renderApp('/expenses?status=draft', {
      lang: 'ar',
      routes: routes(DRAFTS),
    });
    await screen.findByText('رواتب الحراس أكتوبر');
    expect(document.documentElement.dir).toBe('rtl');
    await user.click(screen.getAllByRole('checkbox', { name: 'اختيار الكل في هذه الصفحة' })[0]!);
    const region = screen.getByRole('region', { name: 'المصروفات المختارة' });
    expect(within(region).getByText('تم اختيار 2')).toBeTruthy();
    // Theme tokens only, so the bar follows both themes.
    const classes = [region, ...region.querySelectorAll('[class]')].map((e) =>
      e.getAttribute('class'),
    );
    const raw =
      /\b(?:bg|text|border)-(?:white|black|(?:slate|gray|zinc|red|green|blue|amber)-\d+)\b/;
    expect(classes.filter((c) => c && raw.test(c))).toEqual([]);
    expect(region.className).toContain('flex-wrap');
    expect((await axe.run(region)).violations).toEqual([]);
    await user.click(within(region).getByRole('button', { name: 'ترحيل' }));
    const dialog = await screen.findByRole('dialog', { name: 'ترحيل المسودات المختارة (2)' });
    expect((await axe.run(dialog)).violations).toEqual([]);
  });
});

describe('expense bulk messages', () => {
  it('has the same keys and placeholders in Arabic and English, none empty', () => {
    const keys = Object.keys(expenseBulkMessages.en) as ExpenseBulkMessageKey[];
    expect(Object.keys(expenseBulkMessages.ar).sort()).toEqual([...keys].sort());
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      expect(expenseBulkMessages.ar[k].trim(), k).not.toBe('');
      expect(holes(expenseBulkMessages.ar[k]), k).toEqual(holes(expenseBulkMessages.en[k]));
      expect(expenseBulkMessages.ar[k], k).not.toMatch(/[٠-٩]/);
    }
  });
});
