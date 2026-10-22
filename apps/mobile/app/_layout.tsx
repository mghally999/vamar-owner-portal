import NetInfo from '@react-native-community/netinfo';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LangProvider, useI18n } from '@/lib/i18n';
import { ThemeProvider, useTheme, useThemeChoice } from '@/lib/theme';
import { LockScreen } from '@/screens/lock';

void SplashScreen.preventAutoHideAsync();

// Queries pause while the phone is offline and resume on reconnect; what was fetched last stays
// on screen in the meantime (see OfflineBanner).
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(state.isConnected !== false);
  }),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        const status = (error as { status?: number }).status ?? 0;
        return status === 0 || status >= 500;
      },
      networkMode: 'offlineFirst',
    },
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LangProvider>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <Root />
              </AuthProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </LangProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const t = useTheme();
  const auth = useAuth();
  const { ready } = useI18n();
  const themeChoice = useThemeChoice();
  const [fontsLoaded, fontError] = useFonts({
    'Almarai-Light': require('../../../packages/tokens/assets/fonts/Almarai-Light.ttf'),
    'Almarai-Regular': require('../../../packages/tokens/assets/fonts/Almarai-Regular.ttf'),
    'Almarai-Bold': require('../../../packages/tokens/assets/fonts/Almarai-Bold.ttf'),
    'Almarai-ExtraBold': require('../../../packages/tokens/assets/fonts/Almarai-ExtraBold.ttf'),
  });
  const booted =
    (fontsLoaded || fontError !== null) && ready && themeChoice.ready && auth.stage !== 'loading';

  useEffect(() => {
    if (__DEV__ && !booted) {
      console.info('[boot]', {
        fontsLoaded,
        fontError: fontError?.message ?? null,
        ready,
        stage: auth.stage,
      });
    }
  }, [booted, fontsLoaded, fontError, ready, auth.stage]);

  useEffect(() => {
    if (booted) void SplashScreen.hideAsync();
  }, [booted]);

  if (!booted) return null;

  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }}>
        <Stack.Protected guard={auth.stage === 'authenticated'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="cheque/[id]"
            options={{
              headerShown: true,
              title: '',
              headerTintColor: t.colors.ink,
              headerStyle: { backgroundColor: t.colors.bg },
            }}
          />
          <Stack.Screen
            name="unit/[id]"
            options={{
              headerShown: true,
              title: '',
              headerTintColor: t.colors.ink,
              headerStyle: { backgroundColor: t.colors.bg },
            }}
          />
          <Stack.Screen
            name="dispute/[id]"
            options={{
              headerShown: true,
              title: '',
              headerTintColor: t.colors.ink,
              headerStyle: { backgroundColor: t.colors.bg },
            }}
          />
          <Stack.Screen
            name="settings"
            options={{
              headerShown: true,
              title: '',
              headerTintColor: t.colors.ink,
              headerStyle: { backgroundColor: t.colors.bg },
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={auth.stage !== 'authenticated'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      {auth.stage === 'authenticated' && auth.locked ? <LockScreen /> : null}
    </>
  );
}
