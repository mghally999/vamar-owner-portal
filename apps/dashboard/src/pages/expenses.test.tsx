// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const ROWS = [
  expenseRow(),
  expenseRow({
    id: 'exp-2',
    status: 'draft',
    invoiceDate: '2026-10-25',
    kind: 'fixed',
    categoryId: 'cat-sal',
    categoryNameEn: 'Building staff salaries',
    reasonEn: 'Guard salaries October',
    invoiceNo: null,
    vendorName: null,
    amountFils: 500_000,
    vatFils: 0,
    totalFils: 500_000,
    recurringRuleId: 'rule-1',
    hasAttachments: false,
  }),
];

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings': {
      items: [building(), building({ id: 'bld-2', nameEn: 'Marina Heights' })],
    },
    'GET /api/staff/buildings/:id': buildingDetail(),
    'GET /api/staff/expenses': { ...page(ROWS), totals: expenseTotals() },
    ...extra,
  });

describe('ExpensesPage', () => {
  it("lists the period's expenses with reason, invoice value and VAT, and the totals", async () => {
    const { api } = await renderApp('/expenses', { routes: routes() });
    const link = await screen.findByRole('link', { name: '12 Oct 2026' });
    const row = link.closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Lift 2 repair')).toBeTruthy();
    expect(within(row).getByText('Lifts (repairs)')).toBeTruthy();
    expect(within(row).getByText('Variable')).toBeTruthy();
    expect(within(row).getByText('GL-2026-0417')).toBeTruthy();
    expect(within(row).getByText('AED 13,020')).toBeTruthy();
    expect(within(row).getByText(/VAT \(AED\): 620/)).toBeTruthy();
    expect(within(row).getByText('Posted')).toBeTruthy();
    expect(screen.getByText('2 expenses · AED 18,020')).toBeTruthy();
    expect(screen.getByText(/Fixed 5,000 · Variable 13,020 · VAT 620/)).toBeTruthy();
    expect(api.last('GET', '/api/staff/expenses').query).toMatchObject({
      preset: 'this_month',
      limit: '50',
    });
    expect(screen.getByRole('link', { name: 'Recurring rules' }).getAttribute('href')).toBe(
      '/expenses/rules',
    );
    expect(screen.getByRole('button', { name: 'New expense' })).toBeTruthy();
  });

  it('filters by tab, building, unit, category, kind, status, vendor and text', async () => {
    const { api, user } = await renderApp('/expenses?status=draft', { routes: routes() });
    await screen.findByText('Guard salaries October');
    expect(api.last('GET', '/api/staff/expenses').query['status']).toBe('draft');
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Building' }), 'bld-1');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Unit' }), 'unit-801');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'cat-lift');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'variable');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'posted');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Vendor' }), 'ven-lifts');
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'lift');
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/expenses').query).toMatchObject({
        buildingId: 'bld-1',
        unitId: 'unit-801',
        categoryId: 'cat-lift',
        kind: 'variable',
        status: 'posted',
        vendorId: 'ven-lifts',
        search: 'lift',
      });
    });
    await user.click(screen.getByRole('radio', { name: 'This year' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/expenses').query['preset']).toBe('this_year');
    });
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Posted' }));
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
  });

  it('pages, hides the new button from viewers, and shows empty and error states', async () => {
    const { api, user } = await renderApp('/expenses', {
      role: 'viewer',
      routes: routes({
        'GET /api/staff/expenses': (c: ApiCall) =>
          c.query['cursor']
            ? { ...page([]), totals: expenseTotals() }
            : { ...page(ROWS, 'more'), totals: expenseTotals() },
      }),
    });
    await screen.findByText('Lift 2 repair');
    expect(screen.queryByRole('button', { name: 'New expense' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await vi.waitFor(() => {
      expect(api.last('GET', '/api/staff/expenses').query['cursor']).toBe('more');
    });
    cleanup();
    await renderApp('/expenses', {
      routes: routes({
        'GET /api/staff/expenses': { ...page([]), totals: expenseTotals({ count: 0 }) },
      }),
    });
    expect(await screen.findByText('No expenses in this period.')).toBeTruthy();
    cleanup();
    await renderApp('/expenses', {
      routes: routes({ 'GET /api/staff/expenses': apiError(500, 'internal') }),
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('reads in Arabic', async () => {
    await renderApp('/expenses', { lang: 'ar', routes: routes() });
    expect((await screen.findAllByText('إصلاح المصعد رقم 2')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('مرحَّل').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'قائمة المسودات' })).toBeTruthy();
  });
});
