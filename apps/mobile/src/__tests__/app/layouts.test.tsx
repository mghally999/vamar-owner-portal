import { onlineManager, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Platform, StyleSheet, Text } from 'react-native';
import RootLayout from '../../../app/_layout';
import AuthLayout from '../../../app/(auth)/_layout';
import TabsLayout from '../../../app/(tabs)/_layout';
import { ApiRequestError } from '@/lib/api';
import { setItem } from '@/lib/storage';
import { FloatingTabBar } from '@/ui/tab-bar';
import { mockApi } from '@/test/api';
import { fonts, localAuth, netInfo, splash } from '@/test/native';
import { renderApp, seedSession } from '@/test/render';
import { routeState, router, tabNavigation } from '@/test/router';

// The root layout wires React Query to NetInfo when it loads, before any test runs.
const [connectionListener] = netInfo.addEventListener.mock.calls[0] ?? [];
const splashKeptUp = splash.preventAutoHideAsync.mock.calls.length;

const current = {
  latestVersion: '1.4.0',
  minimumVersion: '1.0.0',
  downloadUrl: 'https://vamar.ae/app',
  apkUrl: 'https://vamar.ae/app.apk',
};

let rootClient: QueryClient | undefined;
function GrabClient() {
  rootClient = useQueryClient();
  return null;
}

beforeEach(async () => {
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await setItem('lang', 'en');
  mockApi({ 'GET /api/app/version': { body: current } });
  routeState.content = () => <GrabClient />;
});

afterEach(() => {
  // The root layout keeps one client for the whole app; start every test from an empty cache.
  rootClient?.clear();
});

describe('Root layout', () => {
  it('keeps the splash screen up from the start', () => {
    expect(splashKeptUp).toBe(1);
  });

  it('shows only the sign-in screens to a signed-out owner, then hides the splash', async () => {
    await render(<RootLayout />);
    expect(await screen.findByTestId('screen:(auth)')).toBeTruthy();
    expect(screen.queryByTestId('screen:(tabs)')).toBeNull();
    expect(screen.queryByTestId('screen:settings')).toBeNull();
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('shows the app with a themed header and back button on each stack screen', async () => {
    await seedSession();
    await render(<RootLayout />);
    expect(await screen.findByTestId('screen:(tabs)')).toBeTruthy();
    expect(screen.queryByTestId('screen:(auth)')).toBeNull();
    for (const title of ['Cheque', 'Unit', 'Case', 'Settings'])
      expect(screen.getByRole('header', { name: title })).toBeTruthy();
    const backs = screen.getAllByRole('button', { name: 'Back' });
    expect(backs).toHaveLength(4);
    await fireEvent.press(backs[0]!);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('shows no back button on a screen opened with nothing behind it', async () => {
    routeState.canGoBack = false;
    await seedSession();
    await render(<RootLayout />);
    await screen.findByTestId('screen:(tabs)');
    expect(screen.queryAllByRole('button', { name: 'Back' })).toHaveLength(0);
  });

  it('renders nothing until the fonts are settled, and starts even if they fail', async () => {
    fonts.useFonts.mockReturnValue([false, null]);
    const { rerender } = await render(<RootLayout />);
    await waitFor(() => {
      expect(console.info).toHaveBeenCalledWith(
        '[boot]',
        expect.objectContaining({ fontsLoaded: false, fontError: null }),
      );
    });
    expect(screen.queryByTestId('stack')).toBeNull();
    expect(splash.hideAsync).not.toHaveBeenCalled();

    fonts.useFonts.mockReturnValue([false, new Error('font missing')]);
    await rerender(<RootLayout />);
    expect(await screen.findByTestId('stack')).toBeTruthy();
  });

  it('locks a signed-in app behind Face ID / fingerprint until unlocked', async () => {
    await seedSession();
    await setItem('biometrics', '1');
    localAuth.authenticateAsync.mockResolvedValueOnce({ success: false });
    await render(<RootLayout />);
    expect(await screen.findByText('Vamar is locked')).toBeTruthy();
    // The check starts by itself when the lock appears.
    expect(localAuth.authenticateAsync).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(screen.queryByText('Vamar is locked')).toBeNull();
    });
  });

  it('lets a locked owner sign out instead', async () => {
    await seedSession();
    await setItem('biometrics', '1');
    localAuth.authenticateAsync.mockResolvedValue({ success: false });
    mockApi({ 'POST /api/auth/owner/logout': { body: { ok: true } } });
    await render(<RootLayout />);
    await screen.findByText('Vamar is locked');
    const signOut = screen.getAllByRole('button', { name: 'Sign out' });
    await fireEvent.press(signOut[signOut.length - 1]!);
    expect(await screen.findByTestId('screen:(auth)')).toBeTruthy();
    expect(screen.queryByText('Vamar is locked')).toBeNull();
  });

  it('blocks the app when the installed version is below the minimum', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockApi({
      'GET /api/app/version': {
        body: { ...current, latestVersion: '2.1.0', minimumVersion: '2.0.0' },
      },
    });
    await render(<RootLayout />);
    expect(await screen.findByText('Please update the app')).toBeTruthy();
    expect(
      screen.getByText(
        'This version (1.4.0) no longer works with Vamar. Install version 2.1.0; your account and data stay as they are.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Download the update' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://vamar.ae/app');
  });

  it('sets the reading direction on the web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await render(<RootLayout />);
    await screen.findByTestId('stack');
    expect(JSON.stringify(screen.toJSON())).toContain('"direction":"ltr"');
  });

  it('pauses queries while the phone is offline', () => {
    expect(connectionListener).toBeDefined();
    connectionListener?.({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    connectionListener?.({ isConnected: null });
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('retries server errors and dead connections twice, and never a refused request', async () => {
    const calls = { server: 0, refused: 0 };
    function Probe() {
      const server = useQuery({
        queryKey: ['probe-server'],
        queryFn: () => {
          calls.server += 1;
          return Promise.reject(new ApiRequestError(503, 'unavailable', 'Down'));
        },
        retryDelay: 0,
      });
      const refused = useQuery({
        queryKey: ['probe-refused'],
        queryFn: () => {
          calls.refused += 1;
          return Promise.reject(new ApiRequestError(404, 'not_found', 'Gone'));
        },
        retryDelay: 0,
      });
      return <Text>{`${server.status} ${refused.status}`}</Text>;
    }
    routeState.content = (name) => (name === '(auth)' ? <Probe /> : null);
    await render(<RootLayout />);
    expect(await screen.findByText('error error')).toBeTruthy();
    expect(calls).toEqual({ server: 3, refused: 1 });
  });
});

describe('Tabs layout', () => {
  it('shows the current tab title and a tab bar with the four tabs', async () => {
    await renderApp(<TabsLayout />, { signedIn: false });
    expect(await screen.findByRole('header', { name: 'Home' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel as string)).toEqual([
      'Home',
      'Cheques',
      'Properties',
      'Disputes',
    ]);
    expect(tabs[0]?.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('opens another tab, and does nothing for the current one', async () => {
    await renderApp(<TabsLayout />, { signedIn: false });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Cheques' }));
    expect(tabNavigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'cheques-key',
      canPreventDefault: true,
    });
    expect(tabNavigation.navigate).toHaveBeenCalledWith('cheques');
    tabNavigation.navigate.mockClear();
    await fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
    expect(tabNavigation.navigate).not.toHaveBeenCalled();
  });

  it('lets a tab press be cancelled', async () => {
    tabNavigation.emit.mockImplementationOnce(() => ({ defaultPrevented: true }));
    await renderApp(<TabsLayout />, { signedIn: false });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Disputes' }));
    expect(tabNavigation.navigate).not.toHaveBeenCalled();
  });

  it('titles the header after the selected tab, in Arabic too', async () => {
    routeState.tabIndex = 2;
    await renderApp(<TabsLayout />, { lang: 'ar', signedIn: false });
    expect(await screen.findByRole('header', { name: 'العقارات' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'العقارات' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('warns under the header when the phone is offline', async () => {
    netInfo.useNetInfo.mockReturnValue({ isConnected: false });
    await renderApp(<TabsLayout />, { signedIn: false });
    const message = await screen.findByText('No connection. Showing the last data received.');
    // Announced as an alert by screen readers.
    expect(message.parent?.props.accessibilityRole).toBe('alert');
  });

  it('outlines the tab bar on the white theme', async () => {
    await setItem('theme', 'white');
    await renderApp(<TabsLayout />, { signedIn: false });
    await waitFor(() => {
      const tabList = screen.getAllByRole('tab')[0]?.parent;
      expect(tabList?.props.accessibilityRole).toBe('tablist');
      expect(StyleSheet.flatten(tabList?.props.style)).toMatchObject({ borderWidth: 0.8 });
    });
  });

  it('falls back to the route name and the home icon for an unknown tab', async () => {
    await renderApp(
      <FloatingTabBar
        {...({
          state: { index: 0, routes: [{ key: 'x', name: 'reports' }] },
          descriptors: { x: { options: {} } },
          navigation: tabNavigation,
        } as unknown as Parameters<typeof FloatingTabBar>[0])}
      />,
      { signedIn: false },
    );
    expect(await screen.findByRole('tab', { name: 'reports' })).toBeTruthy();
  });
});

describe('Sign-in layout', () => {
  it('is a plain stack', async () => {
    await renderApp(<AuthLayout />, { signedIn: false });
    expect(await screen.findByTestId('stack')).toBeTruthy();
  });
});
