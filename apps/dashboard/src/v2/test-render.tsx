/**
 * Renders a v2 page on its own route tree (the pages are wired into the app router by
 * router.tsx; here they mount under a bare layout) with the same providers and API fake as
 * src/test/render.tsx. Usage: `renderV2('/settings', { role: 'admin', routes })`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { configure, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { StaffUser } from '@/lib/api';
import { AuthProvider, useAuth, type AuthState } from '@/lib/auth';
import { LangProvider } from '@/lib/i18n';
import { mockApi, reply, type Routes } from '@/test/api';
import { staffUser } from '@/test/fixtures';
import { v2Routes } from './index';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });
window.scrollTo = () => undefined;

export interface RenderV2Options {
  role?: StaffUser['role'] | null;
  lang?: 'ar' | 'en';
  routes?: Routes;
}

function Whoami() {
  const auth = useAuth();
  return <span data-testid="whoami">{auth.user?.name ?? ''}</span>;
}

export async function renderV2(path: string, opts: RenderV2Options = {}) {
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const rootRoute = createRootRouteWithContext<{ auth: AuthState; queryClient: QueryClient }>()({
    component: () => (
      <div>
        <Whoami />
        <Outlet />
      </div>
    ),
  });
  const shell = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: Outlet });
  const routeTree = rootRoute.addChildren([shell.addChildren(v2Routes(shell))]);
  const router = createRouter({
    routeTree,
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
  if (me) await screen.findByText(me.name);
  return { ...utils, api, router, queryClient, user: userEvent.setup() };
}
