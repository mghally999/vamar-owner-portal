/**
 * The v2 pages (calendar, unit records, settings, holidays, expense categories, vendors,
 * building budgets, owner messages) as routes under the shell and as navigation entries. router.tsx adds
 * `v2Routes(shellRoute)` to the shell's children and shell.tsx appends `V2_NAV` to its NAV list.
 */
import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { CalendarDays, ListTree, Settings, Store, Sun } from 'lucide-react';
import { lazy, Suspense, type ComponentType, type JSX } from 'react';
import { Skeleton } from '@/ui/primitives';

const fallback = (
  <div className="flex flex-col gap-4" aria-busy>
    <Skeleton className="h-8 w-56" />
    <Skeleton className="h-40 w-full" />
  </div>
);

function lazyPage<T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) {
  const C = lazy(async () => ({ default: (await loader())[name] as ComponentType }));
  return () => (
    <Suspense fallback={fallback}>
      <C />
    </Suspense>
  );
}

export const V2_PAGES = {
  calendar: lazyPage(() => import('./calendar-page'), 'CalendarPage'),
  unit: lazyPage(() => import('./unit-page'), 'UnitPage'),
  settings: lazyPage(() => import('./settings-page'), 'SettingsPage'),
  holidays: lazyPage(() => import('./holidays-page'), 'HolidaysPage'),
  categories: lazyPage(() => import('./categories-page'), 'CategoriesPage'),
  vendors: lazyPage(() => import('./vendors-page'), 'VendorsPage'),
  budgets: lazyPage(() => import('./budgets-panel'), 'BudgetsPage'),
  messages: lazyPage(() => import('./messages-page'), 'MessagesPage'),
  messageThread: lazyPage(() => import('./messages-page'), 'MessageThreadPage'),
};

export function v2Routes(shellRoute: AnyRoute): AnyRoute[] {
  const route = (path: string, component: () => JSX.Element) =>
    createRoute({ getParentRoute: () => shellRoute, path, component });
  return [
    route('/calendar', V2_PAGES.calendar),
    route('/units/$unitId', V2_PAGES.unit),
    route('/settings', V2_PAGES.settings),
    route('/holidays', V2_PAGES.holidays),
    route('/expense-categories', V2_PAGES.categories),
    route('/vendors', V2_PAGES.vendors),
    route('/budgets', V2_PAGES.budgets),
    route('/messages', V2_PAGES.messages),
    route('/messages/$threadId', V2_PAGES.messageThread),
  ];
}

export interface V2NavEntry {
  to: string;
  labelAr: string;
  labelEn: string;
  icon: typeof CalendarDays;
  min?: 'admin';
}

export const V2_NAV: V2NavEntry[] = [
  { to: '/calendar', labelAr: 'التقويم', labelEn: 'Calendar', icon: CalendarDays },
  { to: '/vendors', labelAr: 'الموردون', labelEn: 'Vendors', icon: Store },
  {
    to: '/expense-categories',
    labelAr: 'فئات المصروفات',
    labelEn: 'Expense categories',
    icon: ListTree,
    min: 'admin',
  },
  { to: '/holidays', labelAr: 'العطلات', labelEn: 'Holidays', icon: Sun, min: 'admin' },
  { to: '/settings', labelAr: 'الإعدادات', labelEn: 'Settings', icon: Settings, min: 'admin' },
];
