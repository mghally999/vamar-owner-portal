/**
 * Renders a screen inside the app's providers (theme, language, React Query, auth) the way the
 * root layout does, with the language and session taken from the fake keychain.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { LangProvider } from '@/lib/i18n';
import { setItem } from '@/lib/storage';
import { ThemeProvider } from '@/lib/theme';
import { mockApi } from './api';
import { owner } from './fixtures';

export interface AppOptions {
  lang?: 'ar' | 'en';
  /** A stored refresh token the API accepts, so the auth provider resumes the session. */
  signedIn?: boolean;
}

/** No retries, and no garbage-collection timers left running after a test (Infinity = never). */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

export function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <ThemeProvider>
      <LangProvider>
        <QueryClientProvider client={client}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      </LangProvider>
    </ThemeProvider>
  );
}

export async function seedSession(): Promise<void> {
  await setItem('refreshToken', 'refresh-1');
  await setItem('owner', JSON.stringify(owner));
  mockApi({
    'POST /api/auth/owner/refresh': {
      body: {
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        refreshExpiresAt: '2026-12-01T00:00:00Z',
      },
    },
    'POST /api/owner/push-token': { body: { ok: true } },
  });
}

/**
 * Pull down to refresh: a list that owns `onRefresh`, or a scroll view whose `refreshControl`
 * element does (the mocked ScrollView does not render that element, so it is called directly).
 */
export async function pullToRefresh(): Promise<void> {
  const [list] = screen.container.queryAll(
    (node) => typeof node.type === 'string' && typeof node.props.onRefresh === 'function',
  );
  if (list) {
    await fireEvent(list, 'refresh');
    return;
  }
  const [scroll] = screen.container.queryAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof (node.props.refreshControl as { props?: { onRefresh?: unknown } } | undefined)?.props
        ?.onRefresh === 'function',
  );
  if (!scroll) throw new Error('No refreshable list on screen');
  const control = scroll.props.refreshControl as { props: { onRefresh: () => void } };
  await act(async () => {
    control.props.onRefresh();
    await Promise.resolve();
  });
}

export async function renderApp(ui: ReactElement, options: AppOptions = {}) {
  const { lang = 'en', signedIn = true } = options;
  await setItem('lang', lang);
  if (signedIn) await seedSession();
  const client = testQueryClient();
  const result = await render(<Providers client={client}>{ui}</Providers>);
  return { ...result, client };
}
