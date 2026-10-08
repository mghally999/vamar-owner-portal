import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import type { AuthState } from '@/lib/auth';
import { AppShell } from '@/ui/shell';
import { Skeleton } from '@/ui/primitives';
import { LoginPage } from '@/pages/login';

interface RouterContext {
  auth: AuthState;
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

/** Everything under the shell requires a completed TOTP sign-in. */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  beforeLoad: ({ context }) => {
    if (context.auth.stage === 'loading') return;
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects by throwing
    if (context.auth.stage !== 'authenticated') throw redirect({ to: '/login' });
  },
  component: () => {
    return <AppShell />;
  },
});

const fallback = (
  <div className="flex flex-col gap-4" aria-busy>
    <Skeleton className="h-8 w-56" />
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-40 w-full" />
  </div>
);

function lazyPage<T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) {
  const C = lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));
  return () => (
    <Suspense fallback={fallback}>
      <C />
    </Suspense>
  );
}

const overviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: lazyPage(() => import('@/pages/overview'), 'OverviewPage'),
});
const ownersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/owners',
  component: lazyPage(() => import('@/pages/owners'), 'OwnersPage'),
});
const ownerRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/owners/$ownerId',
  component: lazyPage(() => import('@/pages/owner-detail'), 'OwnerDetailPage'),
});
const buildingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/buildings',
  component: lazyPage(() => import('@/pages/buildings'), 'BuildingsPage'),
});
const buildingRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/buildings/$buildingId',
  component: lazyPage(() => import('@/pages/building-detail'), 'BuildingDetailPage'),
});
const contractsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/contracts',
  component: lazyPage(() => import('@/pages/contracts'), 'ContractsPage'),
});
const contractNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/contracts/new',
  component: lazyPage(() => import('@/pages/contract-new'), 'ContractNewPage'),
});
const contractRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/contracts/$contractId',
  component: lazyPage(() => import('@/pages/contract-detail'), 'ContractDetailPage'),
});
const chequesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/cheques',
  component: lazyPage(() => import('@/pages/cheques'), 'ChequesPage'),
});
const chequeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/cheques/$chequeId',
  component: lazyPage(() => import('@/pages/cheque-detail'), 'ChequeDetailPage'),
});
const disputesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/disputes',
  component: lazyPage(() => import('@/pages/disputes'), 'DisputesPage'),
});
const disputeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/disputes/$disputeId',
  component: lazyPage(() => import('@/pages/dispute-detail'), 'DisputeDetailPage'),
});
const importRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/import',
  component: lazyPage(() => import('@/pages/import'), 'ImportPage'),
});
const staffRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/staff',
  component: lazyPage(() => import('@/pages/staff'), 'StaffPage'),
});
const auditRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/audit',
  component: lazyPage(() => import('@/pages/audit'), 'AuditPage'),
});
const catchAll = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: () => <Navigate to="/" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    overviewRoute,
    ownersRoute,
    ownerRoute,
    buildingsRoute,
    buildingRoute,
    contractsRoute,
    contractNewRoute,
    contractRoute,
    chequesRoute,
    chequeRoute,
    disputesRoute,
    disputeRoute,
    importRoute,
    staffRoute,
    auditRoute,
  ]),
  catchAll,
]);

export const router = createRouter({
  routeTree,
  context: {
    auth: undefined as unknown as AuthState,
    queryClient: undefined as unknown as QueryClient,
  },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
