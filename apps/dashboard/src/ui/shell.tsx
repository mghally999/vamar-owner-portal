import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  Receipt,
  ScrollText,
  Search,
  Users,
  UserCog,
  Wrench,
  X,
} from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import type { MessageKey } from '@/lib/messages';
import { Logo } from './logo';
import { cx } from './primitives';
import { useSearchShortcut } from './search-shortcut';

/** The palette (a dialog and the search request) loads the first time it is opened. */
const SearchPalette = lazy(async () => ({
  default: (await import('./search-palette')).SearchPalette,
}));
import { V2_NAV } from '@/v2';

export interface NavItem {
  to: string;
  key: MessageKey;
  icon: typeof LayoutDashboard;
  min?: 'admin';
}

const NAV: NavItem[] = [
  { to: '/', key: 'nav_overview', icon: LayoutDashboard },
  { to: '/owners', key: 'nav_owners', icon: Users },
  { to: '/buildings', key: 'nav_properties', icon: Building2 },
  { to: '/contracts', key: 'nav_contracts', icon: FileText },
  { to: '/cheques', key: 'nav_cheques', icon: ClipboardList },
  { to: '/expenses', key: 'nav_expenses', icon: Receipt },
  { to: '/work-orders', key: 'nav_workOrders', icon: Wrench },
  { to: '/reports', key: 'nav_reports', icon: BarChart3 },
  { to: '/disputes', key: 'nav_disputes', icon: Gavel },
  { to: '/import', key: 'nav_import', icon: FileSpreadsheet },
  { to: '/staff', key: 'nav_staff', icon: UserCog, min: 'admin' },
  { to: '/audit', key: 'nav_audit', icon: ScrollText, min: 'admin' },
];

/** Part B's pages: the calendar sits after Cheques, the admin pages close the list. */
type NavEntry = NavItem | (typeof V2_NAV)[number];
const calendarEntry = V2_NAV.filter((e) => e.to === '/calendar');
const trailingEntries = V2_NAV.filter((e) => e.to !== '/calendar');
const ALL_NAV: NavEntry[] = [
  ...NAV.slice(0, NAV.findIndex((n) => n.to === '/cheques') + 1),
  ...calendarEntry,
  ...NAV.slice(NAV.findIndex((n) => n.to === '/cheques') + 1),
  ...trailingEntries,
];

export function AppShell() {
  const { t, lang, setLang, pick } = useI18n();
  const auth = useAuth();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** Mounted once opened so the dialog can animate closed and keep its state afterwards. */
  const [searchUsed, setSearchUsed] = useState(false);
  if (searchOpen && !searchUsed) setSearchUsed(true);
  useSearchShortcut(setSearchOpen);
  const path = useRouterState({ select: (s) => s.location.pathname });

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label={t('nav_overview')}>
      {ALL_NAV.filter((n) => !n.min || auth.hasRole(n.min)).map((n) => {
        const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
        const label = 'key' in n ? t(n.key) : pick(n.labelAr, n.labelEn);
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={() => {
              setOpen(false);
            }}
            className={cx(
              // 36 px rows from lg up so the whole menu and the signed-in user fit a 900 px tall
              // screen; the phone drawer keeps 44 px touch targets.
              'flex h-11 items-center gap-3 rounded-sm px-3 text-[15px] font-medium lg:h-9',
              active
                ? 'bg-on-header text-header'
                : 'text-on-header-soft hover:bg-hero-tile hover:text-on-header',
            )}
          >
            <n.icon className="size-5 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const searchButton = (
    <button
      type="button"
      onClick={() => {
        setSearchOpen(true);
      }}
      className="flex h-11 items-center gap-3 rounded-sm px-3 text-[15px] text-on-header-soft hover:bg-hero-tile hover:text-on-header lg:h-9"
      aria-keyshortcuts="Control+K"
    >
      <Search className="size-5" aria-hidden />
      {t('search_title')}
      <kbd className="ms-auto rounded-sm border border-header-line px-1.5 text-[11px]">Ctrl K</kbd>
    </button>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-1 border-t border-header-line pt-3">
      {searchButton}
      <div className="px-3 py-2">
        <p className="truncate text-[15px] font-medium text-on-header">{auth.user?.name}</p>
        <p className="truncate text-[13px] text-on-header-soft">
          {auth.user ? t(`role_${auth.user.role}`) : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setLang(lang === 'ar' ? 'en' : 'ar');
        }}
        className="flex h-11 items-center gap-3 rounded-sm px-3 text-[15px] text-on-header-soft hover:bg-hero-tile hover:text-on-header lg:h-9"
      >
        <span
          className="inline-flex size-5 items-center justify-center text-[13px] font-semibold"
          aria-hidden
        >
          {lang === 'ar' ? 'EN' : 'ع'}
        </span>
        {t('language')}
      </button>
      <button
        type="button"
        aria-pressed={theme === 'white'}
        onClick={() => {
          setTheme(theme === 'white' ? 'default' : 'white');
        }}
        className="flex h-11 items-center gap-3 rounded-sm px-3 text-[15px] text-on-header-soft hover:bg-hero-tile hover:text-on-header lg:h-9"
      >
        <Palette className="size-5" aria-hidden />
        {t('theme')}: {t(theme === 'white' ? 'theme_white' : 'theme_default')}
      </button>
      <button
        type="button"
        onClick={() => void auth.logout()}
        className="flex h-11 items-center gap-3 rounded-sm px-3 text-[15px] text-on-header-soft hover:bg-hero-tile hover:text-on-header lg:h-9"
      >
        <LogOut className="size-5 rtl:-scale-x-100" aria-hidden />
        {t('signOut')}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* The sidebar scrolls when the entries do not fit the window, so the last ones never spill
          onto the page background (where their light text would fail contrast). */}
      <aside className="hidden lg:flex lg:flex-col lg:gap-4 lg:border-e lg:border-header-line lg:bg-header lg:px-3 lg:py-5 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <Brand />
        {nav}
        {footer}
      </aside>

      <header className="flex h-14 items-center justify-between rounded-b-2xl border-b border-header-line bg-header px-4 text-on-header lg:hidden">
        <Brand compact />
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-md"
          onClick={() => {
            setOpen(true);
          }}
          aria-label="Menu"
        >
          <Menu className="size-6" />
        </button>
      </header>
      {open ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="flex h-dvh w-72 flex-col gap-6 overflow-y-auto bg-header px-3 py-5 text-on-header">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-md"
                onClick={() => {
                  setOpen(false);
                }}
                aria-label={t('close')}
              >
                <X className="size-6" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
          <button
            type="button"
            className="flex-1 bg-[rgba(37,50,58,0.35)]"
            onClick={() => {
              setOpen(false);
            }}
            aria-label={t('close')}
          />
        </div>
      ) : null}

      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
      {searchUsed ? (
        <Suspense fallback={null}>
          <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-3 text-on-header">
      <Logo variant="mark" height={compact ? 24 : 28} />
      <span
        className={cx('font-semibold tracking-[0.16em]', compact ? 'text-[15px]' : 'text-[17px]')}
      >
        VAMAR
      </span>
    </Link>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
