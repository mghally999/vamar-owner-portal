import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { formatPeriod, resolvePreset, todayInDubai } from '@vamar/shared';
import HomeScreen from '../../../app/(tabs)/index';
import { useAuth, type AuthState } from '@/lib/auth';
import { mockApi, sent } from '@/test/api';
import { cheque, expense, summary } from '@/test/fixtures';
import { localAuth, print, sharing } from '@/test/native';
import { pullToRefresh, renderApp } from '@/test/render';
import { routeState, router } from '@/test/router';

const today = todayInDubai();

let auth: AuthState | undefined;
function AuthHandle() {
  auth = useAuth();
  return <Text>{auth.stage}</Text>;
}

/** Home under a parent that can re-render it, as the router does when the link's params change. */
let rerenderHome: () => void = () => undefined;
function HomeHost() {
  const [, setN] = useState(0);
  rerenderHome = () => {
    setN((n) => n + 1);
  };
  return <HomeScreen />;
}
async function followLink(params: Record<string, string>) {
  await act(async () => {
    routeState.params = params;
    rerenderHome();
    await Promise.resolve();
  });
}

function lastQuery() {
  const all = sent('GET /api/owner/summary');
  return Object.fromEntries(all[all.length - 1]?.query ?? []);
}

const me = (showBeforeFeeLabel = true) => ({
  body: {
    id: 'owner-1',
    settings: {
      weekStart: 'monday',
      hijriDisplay: false,
      showBeforeFeeLabel,
      ownersSeeInvoiceFiles: true,
    },
  },
});

beforeEach(() => {
  auth = undefined;
  mockApi({ 'GET /api/owner/summary': { body: summary() }, 'GET /api/owner/me': me() });
});

describe('Home', () => {
  it("shows this month's rent, expenses and net, the rows and the occupancy", async () => {
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('75,000')).toBeTruthy();
    expect(lastQuery()).toEqual({ preset: 'this_month' });
    expect(screen.getByText('Expected rent')).toBeTruthy();
    expect(screen.getByText('25,000')).toBeTruthy(); // collected
    expect(screen.getByText('40,000')).toBeTruthy(); // outstanding
    expect(screen.getByText('10,000')).toBeTruthy(); // at risk
    expect(screen.getByText('7,500')).toBeTruthy(); // expenses
    expect(screen.getByText('Fixed 6,000 · Variable 1,500')).toBeTruthy();
    expect(screen.getByText('17,500')).toBeTruthy(); // net
    expect(screen.getByText("Net: Before Vamar's management fee")).toBeTruthy();

    expect(screen.getByText('Next cheque')).toBeTruthy();
    expect(screen.getByText('30,000')).toBeTruthy();
    expect(screen.getByText('Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('28 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();

    expect(screen.getByText('Contracts ending soon')).toBeTruthy();
    expect(screen.getByText('Oasis Tower 305')).toBeTruthy();
    expect(screen.getByText('15 Dec 2026')).toBeTruthy();
    expect(screen.getByText('2 open maintenance jobs')).toBeTruthy();
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('3 of 4 units rented')).toBeTruthy();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 75 });
    expect(screen.getByText('2 open disputes')).toBeTruthy();
    expect(screen.getByText('Statement (PDF)')).toBeTruthy();
  });

  it('every number opens the list behind it', async () => {
    await renderApp(<HomeScreen />);
    await fireEvent.press(await screen.findByText('Collected'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/(tabs)/cheques',
      params: { status: 'cleared' },
    });
    await fireEvent.press(screen.getByText('At risk (bounced)'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/(tabs)/cheques',
      params: { status: 'bounced' },
    });
    await fireEvent.press(screen.getByText('Expenses'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/(tabs)/expenses', params: {} });
    await fireEvent.press(screen.getByText('Next cheque'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/cheque/[id]',
      params: { id: 'chq-9' },
    });
    await fireEvent.press(screen.getByText('Oasis Tower 305'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/unit/[id]',
      params: { id: 'unit-3' },
    });
    await fireEvent.press(screen.getByText('2 open maintenance jobs'));
    expect(router.push).toHaveBeenLastCalledWith('/work-orders');
    await fireEvent.press(screen.getByText('Calendar'));
    expect(router.push).toHaveBeenLastCalledWith('/calendar');
    await fireEvent.press(screen.getByText('2 open disputes'));
    expect(router.push).toHaveBeenLastCalledWith('/(tabs)/disputes');
  });

  it('switches period with the chips and the More sheet; the year is one tap away', async () => {
    await renderApp(<HomeScreen />);
    await screen.findByText('75,000');
    await fireEvent.press(screen.getByRole('button', { name: 'This year' }));
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'this_year' });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Next 6 months' }));
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'next_6_months' });
    });
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Last year' }));
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'last_year' });
    });
    // The active choice replaces the "More" chip.
    expect(screen.getByRole('button', { name: 'Last year' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Last year' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Pick a year' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Previous' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    const lastYear = Number(today.slice(0, 4)) - 1;
    await waitFor(() => {
      expect(lastQuery()).toEqual({ from: `${lastYear}-01-01`, to: `${lastYear}-12-31` });
    });
  });

  it('picks a month and a custom range from the sheet', async () => {
    await renderApp(<HomeScreen />);
    await screen.findByText('75,000');
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Pick a month' }));
    await fireEvent.press(await screen.findByText('March'));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    const year = today.slice(0, 4);
    await waitFor(() => {
      expect(lastQuery()).toEqual({ from: `${year}-03-01`, to: `${year}-03-31` });
    });
    await fireEvent.press(screen.getByRole('button', { name: `March ${year}` }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Custom range' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^From:/ }));
    const thisMonth = resolvePreset('this_month', today);
    await fireEvent.press(await screen.findByLabelText(thisMonth.from));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(lastQuery()).toEqual({ from: thisMonth.from, to: today });
    });
  });

  it('labels a future period as projected and hides the fee note when the setting is off', async () => {
    mockApi({
      'GET /api/owner/summary': {
        body: summary({
          isFuture: true,
          preset: 'next_month',
          rent: { ...summary().rent, collectedFils: 0 },
          expenses: {
            ...summary().expenses,
            totalFils: 0,
            fixedFils: 0,
            variableFils: 0,
            projectedFixedFils: 420_000,
          },
          projectedNetFils: 7_080_000,
        }),
      },
      'GET /api/owner/me': me(false),
    });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('Projected net')).toBeTruthy();
    expect(screen.getByText('70,800')).toBeTruthy();
    expect(screen.getByText(/Expected fixed costs to come: 4,200/)).toBeTruthy();
    expect(screen.queryByText(/management fee/)).toBeNull();
  });

  it('shows placeholders while loading', async () => {
    mockApi({ 'GET /api/owner/summary': () => new Promise(() => undefined) });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('Expected rent')).toBeTruthy();
    expect(screen.queryByText('AED')).toBeNull();
    expect(screen.queryByText('Next cheque')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says so when a period has nothing in it', async () => {
    mockApi({
      'GET /api/owner/summary': {
        body: summary({
          rent: {
            expectedFils: 0,
            collectedFils: 0,
            outstandingFils: 0,
            atRiskFils: 0,
            chequeCount: 0,
            bouncedCount: 0,
          },
          expenses: {
            fixedFils: 0,
            variableFils: 0,
            totalFils: 0,
            count: 0,
            projectedFixedFils: 0,
          },
          netFils: 0,
          buckets: [],
          nextCheque: null,
          contractsEnding: [],
          openWorkOrders: 0,
          openDisputes: 0,
        }),
      },
    });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('Nothing recorded for this period')).toBeTruthy();
    expect(screen.getByText('No upcoming cheques.')).toBeTruthy();
    expect(screen.getByText('No contracts end in the next 90 days.')).toBeTruthy();
    expect(screen.getByText('No open maintenance jobs')).toBeTruthy();
    expect(screen.getByText('No open disputes')).toBeTruthy();
  });

  it('opens on the period a notification asks for', async () => {
    routeState.params = { preset: 'last_month' };
    await renderApp(<HomeScreen />);
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'last_month' });
    });
  });

  it('opens on the period of a link when the router keeps it on the address', async () => {
    routeState.globalParams = { preset: 'this_year' };
    await renderApp(<HomeScreen />);
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'this_year' });
    });
  });

  it('follows a new period link while Home is open and ignores unknown presets', async () => {
    await renderApp(<HomeHost />);
    await screen.findByText('75,000');
    await followLink({ preset: 'next_month' });
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'next_month' });
    });
    await followLink({ preset: 'custom' });
    await followLink({ preset: 'next_decade' });
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'next_month' });
    });
  });

  it('opens the month a monthly summary push names and offers its statement at the top', async () => {
    mockApi({
      'GET /api/owner/cheques': {
        body: { items: [cheque({ status: 'cleared' })], nextCursor: null },
      },
      'GET /api/owner/expenses': { body: { items: [expense()], nextCursor: null } },
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
    });
    routeState.params = { from: '2026-10-01', to: '2026-10-31', statement: '1' };
    await renderApp(<HomeHost />);
    await waitFor(() => {
      expect(lastQuery()).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    });
    const card = await screen.findByTestId('statement-link');
    expect(
      within(card).getByText('Rent, expenses and net for this period, as a PDF to keep or share.'),
    ).toBeTruthy();
    // The switcher names the month rather than a date range.
    expect(screen.getByRole('button', { name: 'October 2026' })).toBeTruthy();
    await fireEvent.press(within(card).getByRole('button', { name: 'Statement for October 2026' }));
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalledWith(
        'file:///cache/vamar-statement-October-2026.pdf',
        expect.anything(),
      );
    });
    const html = print.printToFileAsync.mock.calls[0]![0].html;
    expect(html).toContain('Salem Al Kaabi · October 2026');
    expect(Object.fromEntries(sent('GET /api/owner/cheques')[0]!.query)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    // Choosing another period puts the offer away.
    await fireEvent.press(screen.getByRole('button', { name: 'This year' }));
    await waitFor(() => {
      expect(screen.queryByTestId('statement-link')).toBeNull();
    });
  });

  it('a monthly summary push without dates (older payload) opens last month with its statement', async () => {
    routeState.params = { preset: 'last_month', statement: '1' };
    await renderApp(<HomeScreen />);
    await waitFor(() => {
      expect(lastQuery()).toEqual({ preset: 'last_month' });
    });
    const lastMonth = formatPeriod(resolvePreset('last_month', today), 'en');
    const card = await screen.findByTestId('statement-link');
    expect(within(card).getByRole('button', { name: `Statement for ${lastMonth}` })).toBeTruthy();
  });

  it('shows no statement offer for a plain period link', async () => {
    routeState.params = { preset: 'last_month' };
    await renderApp(<HomeScreen />);
    await screen.findByText('75,000');
    expect(screen.queryByTestId('statement-link')).toBeNull();
  });

  it('offers the statement in Arabic', async () => {
    routeState.params = { from: '2026-10-01', to: '2026-10-31', statement: '1' };
    await renderApp(<HomeScreen />, { lang: 'ar' });
    const card = await screen.findByTestId('statement-link');
    expect(within(card).getByRole('button', { name: 'كشف حساب أكتوبر 2026' })).toBeTruthy();
  });

  it('makes the yearly statement from the More sheet', async () => {
    const year = Number(today.slice(0, 4));
    mockApi({
      'GET /api/owner/statement-years': { body: { years: [year, year - 1] } },
      'GET /api/owner/cheques': { body: { items: [], nextCursor: null } },
      'GET /api/owner/expenses': { body: { items: [], nextCursor: null } },
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
    });
    await renderApp(<HomeScreen />);
    await screen.findByText('75,000');
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yearly statement (PDF)' }));
    await fireEvent.press(await screen.findByRole('button', { name: String(year - 1) }));
    await fireEvent.press(
      screen.getByRole('button', { name: `Statement for ${String(year - 1)}` }),
    );
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalled();
    });
    expect(Object.fromEntries(sent('GET /api/owner/summary').at(-1)!.query)).toEqual({
      from: `${String(year - 1)}-01-01`,
      to: `${String(year - 1)}-12-31`,
    });
    expect(print.printToFileAsync.mock.calls[0]![0].html.match(/<tr class="month"/g)).toHaveLength(
      12,
    );
    // The sheet closes once the PDF is shared; Home stays on its own period.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: `Statement for ${String(year - 1)}` }),
      ).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
  });

  it('shows the four quick chips and More together, wrapping instead of scrolling', async () => {
    await renderApp(<HomeScreen />);
    const chips = screen.getByTestId('period-chips');
    expect(chips.props.style).toMatchObject({ flexWrap: 'wrap' });
    for (const name of ['This month', 'Next month', 'Next 6 months', 'This year', 'More'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('counts one open dispute and one job in the singular', async () => {
    mockApi({
      'GET /api/owner/summary': { body: summary({ openDisputes: 1, openWorkOrders: 1 }) },
    });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('1 open dispute')).toBeTruthy();
    expect(screen.getByText('1 open maintenance job')).toBeTruthy();
  });

  it('shows an error with a retry that loads the period again, and reloads when pulled down', async () => {
    mockApi({ 'GET /api/owner/summary': { status: 500, body: {} } });
    await renderApp(<HomeScreen />);
    expect(
      await screen.findByText('Something went wrong. Pull to refresh or try again.'),
    ).toBeTruthy();
    mockApi({ 'GET /api/owner/summary': { body: summary() } });
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('75,000')).toBeTruthy();
    mockApi({
      'GET /api/owner/summary': {
        body: summary({ rent: { ...summary().rent, expectedFils: 8_000_000 } }),
      },
    });
    await pullToRefresh();
    expect(await screen.findByText('80,000')).toBeTruthy();
  });

  it('draws the twelve-month chart for a year with a spoken label per month', async () => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      ...summary().buckets[0]!,
      key: `2026-${String(i + 1).padStart(2, '0')}`,
      expectedFils: (i + 1) * 100_000,
      fixedFils: 50_000,
      variableFils: 0,
      projectedFixedFils: 0,
    }));
    mockApi({ 'GET /api/owner/summary': { body: summary({ preset: 'this_year', buckets }) } });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('Rent and expenses by month')).toBeTruthy();
    expect(screen.getByLabelText('March 2026: rent AED 3,000, expenses AED 500')).toBeTruthy();
    expect(screen.getByText('Rent')).toBeTruthy();
  });

  it('makes a statement PDF for the period from the summary, cheques and expenses', async () => {
    mockApi({
      'GET /api/owner/cheques': {
        body: { items: [cheque({ status: 'cleared' })], nextCursor: null },
      },
      'GET /api/owner/expenses': { body: { items: [expense()], nextCursor: null } },
      'GET /api/owner/disputes': { body: { items: [], nextCursor: null } },
    });
    await renderApp(<HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Statement (PDF)' }));
    await waitFor(() => {
      expect(sharing.shareAsync).toHaveBeenCalled();
    });
    const [options] = print.printToFileAsync.mock.calls[0]!;
    const thisMonth = resolvePreset('this_month', today);
    expect(options.html).toContain(`Salem Al Kaabi · ${formatPeriod(thisMonth, 'en')}`);
    expect(options.html).toContain('Lift 2 repair');
    expect(options.html).toContain('GL-2026-0417');
    expect(options.html).toContain("Before Vamar's management fee");
    expect(Object.fromEntries(sent('GET /api/owner/cheques')[0]!.query)).toEqual({
      from: thisMonth.from,
      to: thisMonth.to,
      limit: '100',
    });
  });

  it('shows the error line when the statement cannot be made', async () => {
    mockApi({ 'GET /api/owner/cheques': { status: 500, body: {} } });
    await renderApp(<HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Statement (PDF)' }));
    expect(
      await screen.findByText('Something went wrong. Pull to refresh or try again.'),
    ).toBeTruthy();
  });

  it('shows Arabic labels and amounts in Arabic', async () => {
    await renderApp(<HomeScreen />, { lang: 'ar' });
    expect(await screen.findByText('الإيجار المتوقع')).toBeTruthy();
    expect(await screen.findByText('75,000')).toBeTruthy();
    expect(screen.getAllByText('درهم').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'هذه السنة' })).toBeTruthy();
    expect(screen.getByText('التقويم')).toBeTruthy();
  });

  it('offers a newer app version once, until dismissed', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockApi({
      'GET /api/app/version': {
        body: {
          latestVersion: '1.6.0',
          minimumVersion: '1.0.0',
          downloadUrl: 'https://vamar.ae/app',
          apkUrl: 'https://vamar.ae/app.apk',
        },
      },
    });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('A new version (1.6.0) is available.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Download the update' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://vamar.ae/app');
    await fireEvent.press(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('A new version (1.6.0) is available.')).toBeNull();
  });

  describe('after the first sign-in on a phone with Face ID / fingerprint', () => {
    async function signInFresh() {
      localAuth.hasHardwareAsync.mockResolvedValue(true);
      mockApi({
        'POST /api/auth/owner/exchange': {
          body: {
            accessToken: 'a',
            refreshToken: 'r',
            owner: { id: 'o', nameAr: 'س', nameEn: 'S', preferredLang: 'en' },
          },
        },
      });
      await renderApp(
        <>
          <AuthHandle />
          <HomeScreen />
        </>,
        { signedIn: false },
      );
      await screen.findByText('anonymous');
      await act(async () => {
        await auth?.sendCode('+971501234567');
        await auth?.verifyCode('123456');
      });
      expect(await screen.findByText('Unlock with Face ID or fingerprint?')).toBeTruthy();
    }

    it('turns the lock on from the offer', async () => {
      await signInFresh();
      await fireEvent.press(screen.getByRole('button', { name: 'Turn on' }));
      await waitFor(() => {
        expect(screen.queryByText('Unlock with Face ID or fingerprint?')).toBeNull();
      });
      expect(auth?.biometricsEnabled).toBe(true);
    });

    it('can be put off', async () => {
      await signInFresh();
      await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
      await waitFor(() => {
        expect(screen.queryByText('Unlock with Face ID or fingerprint?')).toBeNull();
      });
      expect(auth?.biometricsEnabled).toBe(false);
    });
  });
});
