import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LangProvider, useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { LockScreen } from '@/screens/lock';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LangProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <Root />
            </AuthProvider>
          </QueryClientProvider>
        </LangProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const t = useTheme();
  const auth = useAuth();
  const { ready } = useI18n();
  const [fontsLoaded, fontError] = useFonts({
    'IBMPlexSansArabic-Regular': require('../../../packages/tokens/assets/fonts/IBMPlexSansArabic-Regular.ttf'),
    'IBMPlexSansArabic-Medium': require('../../../packages/tokens/assets/fonts/IBMPlexSansArabic-Medium.ttf'),
    'IBMPlexSansArabic-SemiBold': require('../../../packages/tokens/assets/fonts/IBMPlexSansArabic-SemiBold.ttf'),
  });
  const booted = (fontsLoaded || fontError !== null) && ready && auth.stage !== 'loading';

  useEffect(() => {
    if (__DEV__ && !booted) {
      console.log('[boot]', {
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
