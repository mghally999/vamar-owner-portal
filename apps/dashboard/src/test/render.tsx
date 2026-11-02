/**
 * Renders the dashboard as main.tsx does (language, query client, auth, router) on a memory
 * history, with the API faked by `mockApi`. Test files that use it must mock '@/lib/firebase',
 * which needs build-time env vars:
 *
 *   vi.mock('@/lib/firebase', () => ({ firebaseEmailLogin: vi.fn(), firebaseSendVerificationEmail: vi.fn() }));
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { configure, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { StaffUser } from '@/lib/api';
import { AuthProvider, useAuth, type AuthState } from '@/lib/auth';
import { LangProvider } from '@/lib/i18n';
import { router as appRouter } from '@/router';
import { mockApi, reply, type Routes } from './api';
import { staffUser } from './fixtures';

// Route chunks load lazily on first use; give them time on a busy machine.
configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 120_000 });
// jsdom has no layout; the router's scroll handling only needs the call to exist.
window.scrollTo = () => undefined;

/** The item at `index` (negative counts from the end); fails the test when there is none. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) throw new Error(`no item at ${String(index)} of ${String(items.length)}`);
  return item;
}

export function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export interface RenderAppOptions {
  /** Signed-in staff role, or null for a visitor without a session. */
  role?: StaffUser['role'] | null;
  lang?: 'ar' | 'en';
  routes?: Routes;
}

export async function renderApp(path: string, opts: RenderAppOptions = {}) {
  const { role = 'admin', lang = 'en', routes = {} } = opts;
  localStorage.clear();
  localStorage.setItem('vamar.lang', lang);
  const me = role ? staffUser(role) : null;
  if (me) localStorage.setItem('vamar_staff_session', '1');
  const api = mockApi({
    'POST /api/auth/staff/refresh': me
      ? { accessToken: 'access-1', user: me }
      : reply(401, { error: { code: 'unauthenticated', message: 'No session' } }),
    ...routes,
  });
  const queryClient = testQueryClient();
  const router = createRouter({
    routeTree: appRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: undefined as unknown as AuthState, queryClient },
  });
  function App() {
    const auth = useAuth();
    return <RouterProvider router={router} context={{ auth, queryClient }} />;
  }
  const utils = render(
    <LangProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </LangProvider>,
  );
  // The shell footer shows the signed-in name once the session has been restored.
  if (me) await screen.findByText(me.name);
  return { ...utils, api, router, queryClient, user: userEvent.setup() };
}
