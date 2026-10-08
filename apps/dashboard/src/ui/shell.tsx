import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  Building2,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Users,
  UserCog,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { Logo } from './logo';
import { cx } from './primitives';

const NAV: { to: string; key: MessageKey; icon: typeof LayoutDashboard; min?: 'admin' }[] = [
  { to: '/', key: 'nav_overview', icon: LayoutDashboard },
  { to: '/owners', key: 'nav_owners', icon: Users },
  { to: '/buildings', key: 'nav_properties', icon: Building2 },
  { to: '/contracts', key: 'nav_contracts', icon: FileText },
  { to: '/cheques', key: 'nav_cheques', icon: ClipboardList },
  { to: '/disputes', key: 'nav_disputes', icon: Gavel },
  { to: '/import', key: 'nav_import', icon: FileSpreadsheet },
  { to: '/staff', key: 'nav_staff', icon: UserCog, min: 'admin' },
  { to: '/audit', key: 'nav_audit', icon: ScrollText, min: 'admin' },
];

export function AppShell() {
  const { t, lang, setLang } = useI18n();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label={t('nav_overview')}>
      {NAV.filter((n) => !n.min || auth.hasRole(n.min)).map((n) => {
        const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={() => {
              setOpen(false);
            }}
            className={cx(
              'flex h-11 items-center gap-3 rounded-md px-3 text-[15px] font-medium',
              active
                ? 'bg-primary text-on-primary'
                : 'text-ink-soft hover:bg-sunken hover:text-ink',
            )}
          >
            <n.icon className="size-5 shrink-0" aria-hidden />
            {t(n.key)}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
      <div className="px-3 py-2">
        <p className="truncate text-[15px] font-medium">{auth.user?.name}</p>
        <p className="truncate text-[13px] text-ink-soft">
          {auth.user ? t(`role_${auth.user.role}`) : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setLang(lang === 'ar' ? 'en' : 'ar');
        }}
        className="flex h-11 items-center gap-3 rounded-md px-3 text-[15px] text-ink-soft hover:bg-sunken hover:text-ink"
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
        onClick={() => void auth.logout()}
        className="flex h-11 items-center gap-3 rounded-md px-3 text-[15px] text-ink-soft hover:bg-sunken hover:text-ink"
      >
        <LogOut className="size-5 rtl:-scale-x-100" aria-hidden />
        {t('signOut')}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden lg:flex lg:flex-col lg:gap-6 lg:border-e lg:border-line lg:bg-elevated lg:px-3 lg:py-5 lg:sticky lg:top-0 lg:h-dvh">
        <Brand />
        {nav}
        {footer}
      </aside>

      <header className="flex h-14 items-center justify-between border-b border-line bg-elevated px-4 lg:hidden">
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
          <div className="flex w-72 flex-col gap-6 bg-elevated px-3 py-5">
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
            className="flex-1 bg-[rgba(22,40,66,0.35)]"
            onClick={() => {
              setOpen(false);
            }}
            aria-label={t('close')}
          />
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-3 text-ink">
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
