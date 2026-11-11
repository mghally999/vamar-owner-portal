import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { todayInDubai } from '@vamar/shared';
import { mockApi, sent } from '@/test/api';
import { cheque, expense, summary } from '@/test/fixtures';
import { print, sharing } from '@/test/native';
import { renderApp } from '@/test/render';
import { YearStatementPicker } from '@/ui/year-statement';

const thisYear = Number(todayInDubai().slice(0, 4));

const printedHtml = () => print.printToFileAsync.mock.calls.at(-1)?.[0]?.html ?? '';

beforeEach(() => {
  mockApi({
    'GET /api/owner/me': { body: { id: 'owner-1', settings: { showBeforeFeeLabel: true } } },
    'GET /api/owner/summary': (req) => ({
      body: summary({
        preset: 'custom',
        period: { from: req.query.get('from') ?? '', to: req.query.get('to') ?? '' },
      }),
    }),
    'GET /api/owner/cheques': { body: { items: [cheque()], nextCursor: null } },
    'GET /api/owner/expenses': { body: { items: [expense()], nextCursor: null } },
    'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
  });
});

describe('yearly statement picker', () => {
  it('offers this year and the earlier years with data, newest first, and makes the chosen one', async () => {
    const onShared = jest.fn();
    mockApi({
      'GET /api/owner/statement-years': {
        body: { years: [thisYear, thisYear - 1, thisYear - 3] },
      },
    });
    await renderApp(<YearStatementPicker onShared={onShared} />);
    const chips = await screen.findByTestId('statement-years');
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => within(b).getByText(/^\d{4}$/).props.children as string),
    ).toEqual([thisYear, thisYear - 1, thisYear - 3].map(String));
    // This year is chosen first, and says it runs to today.
    expect(screen.getByRole('button', { name: String(thisYear) }).props.accessibilityState).toEqual(
      { selected: true },
    );
    expect(screen.getByText('This year is shown up to today.')).toBeTruthy();
    expect(screen.getByRole('button', { name: String(thisYear - 1) })).toBeTruthy();
    expect(screen.getByRole('button', { name: String(thisYear - 3) })).toBeTruthy();
    // A year without data is not offered, nor any future year.
    expect(screen.queryByRole('button', { name: String(thisYear - 2) })).toBeNull();
    expect(screen.queryByRole('button', { name: String(thisYear + 1) })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: String(thisYear - 3) }));
    expect(screen.queryByText('This year is shown up to today.')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: `Statement for ${String(thisYear - 3)}` }),
    );
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalled();
    });
    expect(onShared).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(sent('GET /api/owner/summary')[0]!.query)).toEqual({
      from: `${String(thisYear - 3)}-01-01`,
      to: `${String(thisYear - 3)}-12-31`,
    });
    const html = printedHtml();
    expect(html).toContain('<h1>Yearly statement</h1>');
    expect(html).toContain(`Salem Al Kaabi · ${String(thisYear - 3)}`);
    expect(html.match(/<tr class="month"/g)).toHaveLength(12);
  });

  it('falls back to this year and the four before when the API cannot list the years', async () => {
    await renderApp(<YearStatementPicker />);
    await screen.findByTestId('statement-years');
    for (let i = 0; i < 5; i += 1)
      expect(screen.getByRole('button', { name: String(thisYear - i) })).toBeTruthy();
    expect(screen.queryByRole('button', { name: String(thisYear - 5) })).toBeNull();
  });

  it('says so when the statement cannot be made', async () => {
    mockApi({
      'GET /api/owner/statement-years': { body: { years: [thisYear] } },
      'GET /api/owner/summary': { status: 500, body: {} },
    });
    await renderApp(<YearStatementPicker />);
    await fireEvent.press(
      await screen.findByRole('button', { name: `Statement for ${String(thisYear)}` }),
    );
    expect(
      await screen.findByText('Something went wrong. Pull to refresh or try again.'),
    ).toBeTruthy();
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('is in Arabic with Western digits', async () => {
    mockApi({ 'GET /api/owner/statement-years': { body: { years: [thisYear, thisYear - 1] } } });
    await renderApp(<YearStatementPicker />, { lang: 'ar' });
    expect(await screen.findByText('السنة')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: String(thisYear - 1) }));
    await fireEvent.press(screen.getByRole('button', { name: `كشف حساب ${String(thisYear - 1)}` }));
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalled();
    });
    const html = printedHtml();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('<h1>كشف الحساب السنوي</h1>');
    expect(html).not.toMatch(/[٠-٩]/);
  });
});
