// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { todayInDubai } from '@vamar/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, type ApiCall } from '@/test/api';
import { buildingDetail } from '@/test/fixtures';
import { v2Routes } from '@/test/fixtures-v2';
import { renderApp } from '@/test/render';
import type { BudgetLineRow, BudgetReport } from './budgets-queries';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const YEAR = Number(todayInDubai().slice(0, 4));

const line = (o: Partial<BudgetLineRow> = {}): BudgetLineRow => ({
  budgetId: 'bud-lift',
  categoryId: 'cat-lift',
  nameAr: 'إصلاح المصاعد',
  nameEn: 'Lifts (repairs)',
  budgetFils: 1_500_000,
  actualFils: 1_302_000,
  actualToDateFils: 1_302_000,
  budgetToDateFils: 1_150_000,
  projectedFils: 0,
  forecastFils: 1_302_000,
  percent: 86,
  forecastPercent: 86,
  toDatePercent: 113,
  level: 'near',
  forecastLevel: 'near',
  ...o,
});

const total = line({
  budgetId: 'bud-total',
  categoryId: null,
  nameAr: null,
  nameEn: null,
  budgetFils: 20_000_000,
  actualFils: 11_700_000,
  actualToDateFils: 11_700_000,
  budgetToDateFils: 15_342_466,
  projectedFils: 3_000_000,
  forecastFils: 14_700_000,
  percent: 58,
  forecastPercent: 73,
  toDatePercent: 76,
  level: 'ok',
  forecastLevel: 'ok',
});

const report = (lines: BudgetLineRow[] = [line(), total], year = 2026): BudgetReport => ({
  year,
  today: '2026-10-07',
  buildings: [{ buildingId: 'bld-1', nameAr: 'برج النور', nameEn: 'Al Noor Tower', lines }],
});

const routes = (extra: Record<string, unknown> = {}) =>
  v2Routes({
    'GET /api/staff/buildings/bld-1': buildingDetail(),
    'GET /api/staff/budgets': (c: ApiCall) =>
      c.query['year'] === '2026' || c.query['year'] === String(YEAR)
        ? report()
        : { year: Number(c.query['year']), today: '2026-10-07', buildings: [] },
    ...extra,
  });

describe('/budgets', () => {
  it('shows every budgeted building with spend, year to date and forecast per line', async () => {
    const { api, user, router } = await renderApp('/budgets?year=2026', { routes: routes() });
    expect(await screen.findByRole('heading', { name: 'Budgets' })).toBeTruthy();
    const noor = await screen.findByRole('region', { name: 'Al Noor Tower' });
    expect(within(noor).getByRole('link', { name: 'Al Noor Tower' }).getAttribute('href')).toBe(
      '/buildings/bld-1',
    );
    expect(api.last('GET', '/api/staff/budgets').query).toEqual({ year: '2026' });
    const items = within(noor).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [lifts, all] = items as [HTMLElement, HTMLElement];
    expect(within(lifts).getByText('Lifts (repairs)')).toBeTruthy();
    expect(within(lifts).getByText('86%')).toBeTruthy();
    expect(within(lifts).getByText('80% or more used')).toBeTruthy();
    expect(within(lifts).getByText('AED 13,020 spent of AED 15,000')).toBeTruthy();
    expect(
      within(lifts).getByText(
        'Year to date: AED 13,020 against AED 11,500 expected by today (113%)',
      ),
    ).toBeTruthy();
    expect(within(lifts).getByRole('img', { name: 'Lifts (repairs): 86%' })).toBeTruthy();
    // The total line comes last, named, with the fixed costs still due.
    expect(within(all).getByText('All expenses')).toBeTruthy();
    expect(
      within(all).getByText('With the fixed costs still due (AED 30,000): AED 147,000 (73%)'),
    ).toBeTruthy();
    expect(within(all).queryByText('80% or more used')).toBeNull();
    // Nobody edits from this page.
    expect(screen.queryByRole('button', { name: /Change|Remove/ })).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '2027');
    expect(await screen.findByText('No budgets for this year.')).toBeTruthy();
    expect(api.last('GET', '/api/staff/budgets').query).toEqual({ year: '2027' });
    expect(router.state.location.search).toEqual({ year: 2027 });
  });

  it('reads right to left in Arabic with Western digits and the used-up level', async () => {
    await renderApp('/budgets?year=2026', {
      lang: 'ar',
      routes: routes({
        'GET /api/staff/budgets': report([
          line({
            actualFils: 1_560_000,
            percent: 104,
            forecastFils: 1_560_000,
            forecastPercent: 104,
            level: 'over',
            forecastLevel: 'over',
          }),
          total,
        ]),
      }),
    });
    expect(await screen.findByRole('heading', { name: 'الميزانيات' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    const noor = await screen.findByRole('region', { name: 'برج النور' });
    expect(within(noor).getByText('إصلاح المصاعد')).toBeTruthy();
    expect(within(noor).getByText('إجمالي المصروفات')).toBeTruthy();
    expect(within(noor).getByText('نفدت الميزانية')).toBeTruthy();
    expect(within(noor).getByText('104%')).toBeTruthy();
    expect(within(noor).getByText('صُرف 15,600 درهم من 15,000 درهم')).toBeTruthy();
    expect(noor.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe('the building page budget section', () => {
  it('admins add a line for a category that has none yet, and hear when it already exists', async () => {
    let conflict = false;
    const { api, user } = await renderApp('/buildings/bld-1', {
      routes: routes({
        'POST /api/staff/budgets': () =>
          conflict ? apiError(409, 'conflict', 'exists') : { id: 'bud-new' },
      }),
    });
    const section = await screen.findByRole('region', { name: 'Budget' });
    await within(section).findByText('Lifts (repairs)');
    await user.click(within(section).getByRole('button', { name: 'Add line' }));
    const dialog = await screen.findByRole('dialog', { name: 'New budget line' });
    const category = within(dialog).getByRole('combobox', { name: 'Category' });
    // The total and the lift repairs already have a line this year.
    const options = within(category)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).not.toContain('Lifts (repairs)');
    expect(options).not.toContain('All expenses (every category)');
    await user.selectOptions(category, 'cat-sal');
    await user.type(within(dialog).getByRole('textbox', { name: /Yearly budget/ }), '120,000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Budget saved.')).toBeTruthy();
    expect(api.last('POST', '/api/staff/budgets').body).toEqual({
      buildingId: 'bld-1',
      year: YEAR,
      categoryId: 'cat-sal',
      amountFils: 12_000_000,
    });

    conflict = true;
    await user.click(within(section).getByRole('button', { name: 'Add line' }));
    const again = await screen.findByRole('dialog', { name: 'New budget line' });
    await user.type(within(again).getByRole('textbox', { name: /Yearly budget/ }), '5,000');
    await user.click(within(again).getByRole('button', { name: 'Save' }));
    expect(
      await within(again).findByText(
        'This building already has that line for the year. Change its amount instead.',
      ),
    ).toBeTruthy();
  });

  it('admins change an amount and remove a line', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, user } = await renderApp('/buildings/bld-1', {
      routes: routes({
        'PATCH /api/staff/budgets/:id': { id: 'bud-lift' },
        'DELETE /api/staff/budgets/:id': { ok: true },
      }),
    });
    const section = await screen.findByRole('region', { name: 'Budget' });
    await user.click(
      await within(section).findByRole('button', { name: 'Change Lifts (repairs)' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Change budget' });
    const amount = within(dialog).getByRole('textbox', { name: /Yearly budget/ });
    expect((amount as HTMLInputElement).value).toBe('15,000');
    await user.clear(amount);
    await user.type(amount, '16000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Budget saved.');
    expect(api.last('PATCH', '/api/staff/budgets/bud-lift').body).toEqual({
      amountFils: 1_600_000,
    });

    await user.click(within(section).getByRole('button', { name: 'Remove All expenses' }));
    expect(await screen.findByText('Line removed.')).toBeTruthy();
    expect(api.to('DELETE', '/api/staff/budgets/bud-total')).toHaveLength(1);
  });

  it('editors and viewers read only; a building without a budget says so', async () => {
    await renderApp('/buildings/bld-1', { role: 'editor', routes: routes() });
    const section = await screen.findByRole('region', { name: 'Budget' });
    await within(section).findByText('Lifts (repairs)');
    expect(within(section).queryByRole('button', { name: 'Add line' })).toBeNull();
    expect(within(section).queryByRole('button', { name: /Change|Remove/ })).toBeNull();
    cleanup();
    await renderApp('/buildings/bld-1', {
      role: 'viewer',
      lang: 'ar',
      routes: routes({
        'GET /api/staff/budgets': { year: YEAR, today: '2026-10-07', buildings: [] },
      }),
    });
    const ar = await screen.findByRole('region', { name: 'الميزانية' });
    expect(
      await within(ar).findByText(`لم تُحدَّد ميزانية لهذا المبنى في ${String(YEAR)}.`),
    ).toBeTruthy();
  });
});
