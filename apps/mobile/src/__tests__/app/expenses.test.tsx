import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import ExpensesScreen from '../../../app/(tabs)/expenses';
import ExpenseDetailScreen from '../../../app/expense/[id]';
import { setAccessToken } from '@/lib/api';
import { mockApi, sent } from '@/test/api';
import { building, expense, expenseDetail, summary } from '@/test/fixtures';
import { pullToRefresh, renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

const items = [
  expense(),
  expense({
    id: 'exp-2',
    kind: 'fixed',
    categoryId: 'cat-sal',
    categoryNameEn: 'Building staff salaries',
    categoryNameAr: 'رواتب',
    reasonEn: 'October salaries',
    reasonAr: 'رواتب أكتوبر',
    invoiceNo: null,
    invoiceDate: '2026-10-25',
    grossAmountFils: 650_000,
    grossVatFils: 0,
    grossTotalFils: 650_000,
    amountFils: 260_000,
    shared: true,
    vendorName: null,
    hasAttachments: false,
  }),
  expense({
    id: 'exp-3',
    scope: 'unit',
    unitId: 'unit-1',
    unitNo: '1204',
    kind: 'variable',
    categoryId: 'cat-plumb',
    categoryNameEn: 'Plumbing',
    categoryNameAr: 'سباكة',
    reasonEn: 'Kitchen sink leak repaired',
    reasonAr: 'إصلاح تسريب',
    grossAmountFils: 42_000,
    grossVatFils: 0,
    grossTotalFils: 42_000,
    amountFils: 42_000,
    hasAttachments: false,
  }),
];

function lastQuery() {
  const all = sent('GET /api/owner/expenses');
  return Object.fromEntries(all[all.length - 1]?.query ?? []);
}

beforeEach(() => {
  mockApi({
    'GET /api/owner/buildings': {
      body: { items: [building(), building({ id: 'bld-2', nameEn: 'Al Nada Villa' })] },
    },
    'GET /api/owner/expenses': { body: { items, nextCursor: null } },
    'GET /api/owner/summary': { body: summary() },
  });
});

describe('Expenses tab', () => {
  it('lists the period with totals, category, reason, property, date, value and VAT', async () => {
    await renderApp(<ExpensesScreen />);
    expect(await screen.findByText('Lift 2 repair')).toBeTruthy();
    expect(lastQuery()).toEqual({ preset: 'this_month', limit: '50' });
    expect(screen.getByText('Total for the period')).toBeTruthy();
    expect(screen.getByText('7,500')).toBeTruthy();
    expect(screen.getAllByText('Lifts (repairs)')).toHaveLength(2); // the row and the filter chip
    expect(screen.getByText('Oasis Tower · Whole building · 12 Oct 2026')).toBeTruthy();
    expect(screen.getByText('AED 13,020')).toBeTruthy();
    expect(screen.getByText('VAT 620')).toBeTruthy();
    // A shared fixed cost shows the owner's share of the total.
    expect(screen.getByText('October salaries')).toBeTruthy();
    expect(screen.getByText('AED 2,600')).toBeTruthy();
    expect(screen.getByText('Your share of 2,600 / 6,500')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 1204 · 12 Oct 2026')).toBeTruthy();
    expect(screen.getAllByText('Variable').length).toBeGreaterThan(1);
  });

  it('switches month, 6 months and year, fixed versus variable, property and category', async () => {
    await renderApp(<ExpensesScreen />);
    await screen.findByText('Lift 2 repair');
    await fireEvent.press(screen.getByRole('tab', { name: '6 months' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ preset: 'last_6_months' });
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Year' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ preset: 'this_year' });
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Fixed' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ kind: 'fixed' });
    });
    expect(screen.getByText('6,000')).toBeTruthy(); // the fixed total
    await fireEvent.press(screen.getByRole('tab', { name: 'All' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Al Nada Villa' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ buildingId: 'bld-2' });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Plumbing' }));
    await waitFor(() => {
      expect(lastQuery()).toMatchObject({ categoryId: 'cat-plumb' });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'All categories' }));
    await waitFor(() => {
      expect(lastQuery().categoryId).toBeUndefined();
    });
  });

  it('opens an expense, pages, reloads, and says when there is nothing', async () => {
    await renderApp(<ExpensesScreen />);
    await fireEvent.press(await screen.findByText('Lift 2 repair'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/expense/[id]',
      params: { id: 'exp-1' },
    });
    mockApi({
      'GET /api/owner/expenses': (req) =>
        req.query.get('cursor') === 'p2'
          ? {
              body: {
                items: [expense({ id: 'exp-9', reasonEn: 'Pest control' })],
                nextCursor: null,
              },
            }
          : { body: { items, nextCursor: 'p2' } },
    });
    await pullToRefresh();
    await fireEvent(await screen.findByText('Lift 2 repair'), 'endReached');
    expect(await screen.findByText('Pest control')).toBeTruthy();
    mockApi({ 'GET /api/owner/expenses': { body: { items: [], nextCursor: null } } });
    await pullToRefresh();
    expect(await screen.findByText('No expenses in this period')).toBeTruthy();
  });

  it('shows placeholders and an error with a retry', async () => {
    mockApi({ 'GET /api/owner/expenses': () => new Promise(() => undefined) });
    const first = await renderApp(<ExpensesScreen />);
    expect(await screen.findByText('Total for the period')).toBeTruthy();
    expect(screen.queryByText('Lift 2 repair')).toBeNull();
    await first.unmount();
    mockApi({ 'GET /api/owner/expenses': { status: 500, body: {} } });
    await renderApp(<ExpensesScreen />);
    mockApi({ 'GET /api/owner/expenses': { body: { items, nextCursor: null } } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Lift 2 repair')).toBeTruthy();
  });

  it('reads in Arabic', async () => {
    await renderApp(<ExpensesScreen />, { lang: 'ar' });
    expect(await screen.findByText('إصلاح المصعد رقم 2')).toBeTruthy();
    expect(screen.getByText('إجمالي الفترة')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'ثابتة' })).toBeTruthy();
  });
});

describe('Expense detail', () => {
  beforeEach(() => {
    routeState.params = { id: 'exp-1' };
    setAccessToken('access-1');
  });

  it('shows the share, the invoice image, every fact and the linked job', async () => {
    mockApi({ 'GET /api/owner/expenses/exp-1': { body: expenseDetail() } });
    await renderApp(<ExpenseDetailScreen />, { signedIn: false });
    expect(await screen.findByText('AED 13,020')).toBeTruthy();
    expect(screen.getAllByText('Lift 2 repair').length).toBeGreaterThan(0);
    expect(screen.getByText('Lifts (repairs) · Variable')).toBeTruthy();
    expect(screen.getByText('Oasis Tower · Whole building')).toBeTruthy();
    expect(screen.getByText('Gulf Lifts Technical Services')).toBeTruthy();
    expect(screen.getByText('GL-2026-0417')).toBeTruthy();
    expect(screen.getByText('12 Oct 2026')).toBeTruthy();
    expect(screen.getByText('AED 12,400')).toBeTruthy();
    expect(screen.getByText('AED 620')).toBeTruthy();
    expect(screen.getByText('19 Oct 2026 · Transfer')).toBeTruthy();
    const image = screen.getByLabelText('invoice-GL-2026-0417.jpg');
    expect(image).toBeTruthy();
    await fireEvent.press(image);
    expect(await screen.findByLabelText('Invoice')).toBeTruthy();
    expect(screen.getByText('Lift 2 out of service')).toBeTruthy();
    expect(screen.getByText('Done · 12 Oct 2026')).toBeTruthy();
    await fireEvent.press(screen.getByText('Lift 2 out of service'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/work-order/[id]',
      params: { id: 'wo-1' },
    });
  });

  it('opens a PDF invoice outside, shows the share of a shared cost and the case, or says there is no file', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockApi({
      'GET /api/owner/expenses/exp-1': {
        body: expenseDetail({
          shared: true,
          amountFils: 651_000,
          disputeId: 'dsp-1',
          disputeCaseNo: 'D-2026-0001',
          workOrder: null,
          coversFrom: '2026-10-01',
          coversTo: '2026-10-31',
          attachments: [
            {
              id: 'att-pdf',
              fileName: 'invoice.pdf',
              mime: 'application/pdf',
              sizeBytes: 1,
              createdAt: '',
            },
          ],
        }),
      },
    });
    await renderApp(<ExpenseDetailScreen />, { signedIn: false });
    expect(await screen.findByText('Your share AED 6,510 of AED 13,020')).toBeTruthy();
    expect(screen.getByText('D-2026-0001')).toBeTruthy();
    expect(screen.getByText('1 Oct 2026 – 31 Oct 2026')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open the invoice · invoice.pdf' }));
    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining('/api/owner/attachments/att-pdf'),
    );
    mockApi({ 'GET /api/owner/expenses/exp-1': { body: expenseDetail({ attachments: [] }) } });
    await renderApp(<ExpenseDetailScreen />, { signedIn: false });
    expect(await screen.findByText('No invoice file attached.')).toBeTruthy();
  });

  it('shows placeholders then an error with a retry', async () => {
    mockApi({ 'GET /api/owner/expenses/exp-1': { status: 500, body: {} } });
    await renderApp(<ExpenseDetailScreen />, { signedIn: false });
    mockApi({ 'GET /api/owner/expenses/exp-1': { body: expenseDetail() } });
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('AED 13,020')).toBeTruthy();
  });
});
