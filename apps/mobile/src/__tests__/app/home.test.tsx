import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import { todayInDubai } from '@vamar/shared';
import HomeScreen from '../../../app/(tabs)/index';
import { useAuth, type AuthState } from '@/lib/auth';
import { mockApi, sent } from '@/test/api';
import { home } from '@/test/fixtures';
import { localAuth } from '@/test/native';
import { pullToRefresh, renderApp } from '@/test/render';
import { router } from '@/test/router';

const thisMonth = todayInDubai().slice(0, 7);

let auth: AuthState | undefined;
function AuthHandle() {
  auth = useAuth();
  return <Text>{auth.stage}</Text>;
}

beforeEach(() => {
  auth = undefined;
  mockApi({ 'GET /api/owner/home': { body: home() } });
});

describe('Home', () => {
  it("shows this month's money, the next cheque, occupancy and disputes", async () => {
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('75,000')).toBeTruthy();
    expect(sent('GET /api/owner/home')[0]?.query.get('month')).toBe(thisMonth);
    expect(screen.getByText('Expected this month')).toBeTruthy();
    expect(screen.getByText('25,000')).toBeTruthy();
    expect(screen.getByText('40,000')).toBeTruthy();
    expect(screen.getByText('10,000')).toBeTruthy();
    expect(screen.getByText('18,000')).toBeTruthy();

    expect(screen.getByText('Next cheque')).toBeTruthy();
    expect(screen.getByText('30,000')).toBeTruthy();
    expect(screen.getByText('Ahmed Rahman')).toBeTruthy();
    expect(screen.getByText('28 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();

    expect(screen.getByText('3 of 4 units rented')).toBeTruthy();
    expect(screen.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 75 });
    expect(screen.getByText('Vacant units')).toBeTruthy();
    expect(screen.getByText('Vacant since 1 Aug 2026')).toBeTruthy();
    expect(screen.getByText('Al Nada Villa')).toBeTruthy();
    expect(screen.getByText('Never rented')).toBeTruthy();
    expect(screen.getByText('2 open disputes')).toBeTruthy();
  });

  it('opens the next cheque, a vacant unit and the disputes tab', async () => {
    await renderApp(<HomeScreen />);
    await fireEvent.press(await screen.findByText('Next cheque'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/cheque/[id]',
      params: { id: 'chq-9' },
    });
    await fireEvent.press(screen.getByText('Al Nada Villa'));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/unit/[id]',
      params: { id: 'unit-8' },
    });
    await fireEvent.press(screen.getByText('2 open disputes'));
    expect(router.push).toHaveBeenLastCalledWith('/(tabs)/disputes');
  });

  it('shows placeholders while loading', async () => {
    mockApi({ 'GET /api/owner/home': () => new Promise(() => undefined) });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('Expected this month')).toBeTruthy();
    expect(screen.queryByText('AED')).toBeNull();
    expect(screen.queryByText('Next cheque')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says so when a month has no cheques and nothing is coming', async () => {
    mockApi({
      'GET /api/owner/home': {
        body: home({
          expectedFils: 0,
          clearedFils: 0,
          pendingFils: 0,
          bouncedFils: 0,
          nextCheque: null,
          vacantUnits: [],
          openDisputes: 0,
        }),
      },
    });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('No cheques this month')).toBeTruthy();
    expect(screen.getByText('No upcoming cheques.')).toBeTruthy();
    expect(screen.getByText('No open disputes')).toBeTruthy();
    expect(screen.queryByText('Vacant units')).toBeNull();
  });

  it('counts one open dispute in the singular', async () => {
    mockApi({ 'GET /api/owner/home': { body: home({ openDisputes: 1 }) } });
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('1 open dispute')).toBeTruthy();
  });

  it('shows an error with a retry that loads the month again', async () => {
    mockApi({ 'GET /api/owner/home': { status: 500, body: {} } });
    await renderApp(<HomeScreen />);
    expect(
      await screen.findByText('Something went wrong. Pull to refresh or try again.'),
    ).toBeTruthy();
    mockApi({ 'GET /api/owner/home': { body: home() } });
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('75,000')).toBeTruthy();
  });

  it('reloads the month when pulled down', async () => {
    await renderApp(<HomeScreen />);
    await screen.findByText('75,000');
    mockApi({ 'GET /api/owner/home': { body: home({ expectedFils: 8_000_000 }) } });
    await pullToRefresh();
    expect(await screen.findByText('80,000')).toBeTruthy();
  });

  it('loads the previous month from the month switcher', async () => {
    await renderApp(<HomeScreen />);
    await screen.findByText('75,000');
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => {
      expect(sent('GET /api/owner/home')).toHaveLength(2);
    });
    const [y, m] = thisMonth.split('-').map(Number) as [number, number];
    const previous = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    expect(sent('GET /api/owner/home')[1]?.query.get('month')).toBe(previous);
  });

  it('shows Arabic labels and amounts in Arabic', async () => {
    await renderApp(<HomeScreen />, { lang: 'ar' });
    expect(await screen.findByText('المتوقع هذا الشهر')).toBeTruthy();
    expect(await screen.findByText('75,000')).toBeTruthy();
    expect(screen.getAllByText('درهم').length).toBeGreaterThan(0);
    expect(screen.getByText('فيلا الندى')).toBeTruthy();
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
      expect(screen.queryByText('Unlock with Face ID or fingerprint?')).toBeNull();
      expect(auth?.biometricsEnabled).toBe(false);
    });
  });
});
