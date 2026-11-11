import { screen, within } from '@testing-library/react-native';
import PropertiesScreen from '../../../app/(tabs)/properties';
import type { OwnerBudgetLine, OwnerBudgets } from '@/lib/budget-queries';
import { mockApi } from '@/test/api';
import { building, unit } from '@/test/fixtures';
import { renderApp } from '@/test/render';

const line = (over: Partial<OwnerBudgetLine> = {}): OwnerBudgetLine => ({
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
  ...over,
});

const budgets: OwnerBudgets = {
  year: 2026,
  today: '2026-10-07',
  buildings: [
    {
      buildingId: 'bld-1',
      nameAr: 'برج الواحة',
      nameEn: 'Oasis Tower',
      lines: [
        line(),
        line({
          budgetId: 'bud-total',
          categoryId: null,
          nameAr: null,
          nameEn: null,
          budgetFils: 20_000_000,
          actualFils: 11_700_000,
          projectedFils: 3_000_000,
          forecastFils: 14_700_000,
          percent: 58,
          forecastPercent: 73,
          level: 'ok',
          forecastLevel: 'ok',
        }),
      ],
    },
  ],
};

function api(budgetReply: unknown = { body: budgets }) {
  mockApi({
    'GET /api/owner/buildings': {
      body: { items: [building(), building({ id: 'bld-2', nameEn: 'Al Nada Villa' })] },
    },
    'GET /api/owner/units': {
      body: { items: [unit(), unit({ id: 'unit-2', unitNo: 'V1', buildingId: 'bld-2' })] },
    },
    'GET /api/owner/budgets': budgetReply as never,
  });
}

describe('Building budget card', () => {
  it("shows the building's budget lines in English, the total last", async () => {
    api();
    await renderApp(<PropertiesScreen />);
    const card = await screen.findByTestId('budget-bld-1');
    expect(within(card).getByText('2026 budget')).toBeTruthy();
    expect(within(card).getByText('Lifts (repairs)')).toBeTruthy();
    expect(within(card).getByText('86%')).toBeTruthy();
    expect(
      within(card).getByText('AED 13,020 spent of AED 15,000 · 80% or more used'),
    ).toBeTruthy();
    expect(within(card).getByText('All expenses')).toBeTruthy();
    expect(within(card).getByText('AED 117,000 spent of AED 200,000')).toBeTruthy();
    expect(
      within(card).getByText('Expected with the fixed costs still due: AED 147,000 (73%)'),
    ).toBeTruthy();
    expect(
      within(card).getByText("The building's full figures as Vamar manages them, not your share."),
    ).toBeTruthy();
    expect(within(card).getByLabelText('Lifts (repairs)').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 86,
    });
    // A building without a budget shows no card.
    expect(screen.queryByTestId('budget-bld-2')).toBeNull();
  });

  it('reads in Arabic with Western digits, a used-up line marked', async () => {
    api({
      body: {
        ...budgets,
        buildings: [
          {
            ...budgets.buildings[0]!,
            lines: [
              line({
                actualFils: 1_560_000,
                forecastFils: 1_560_000,
                percent: 104,
                forecastPercent: 104,
                level: 'over',
                forecastLevel: 'over',
              }),
            ],
          },
        ],
      },
    });
    await renderApp(<PropertiesScreen />, { lang: 'ar' });
    const card = await screen.findByTestId('budget-bld-1');
    expect(within(card).getByText('ميزانية 2026')).toBeTruthy();
    expect(within(card).getByText('إصلاح المصاعد')).toBeTruthy();
    expect(within(card).getByText('104%')).toBeTruthy();
    expect(within(card).getByText('صُرف 15,600 درهم من 15,000 درهم · نفدت الميزانية')).toBeTruthy();
    expect(within(card).getByText('أرقام المبنى كاملة كما تديرها فامار، لا حصتك.')).toBeTruthy();
  });

  it('leaves the building card as it was when budgets cannot be loaded', async () => {
    api({ status: 500, body: { error: { code: 'internal', message: 'down' } } });
    await renderApp(<PropertiesScreen />);
    expect(await screen.findByText('Oasis Tower')).toBeTruthy();
    expect(screen.queryByTestId('budget-bld-1')).toBeNull();
  });
});
