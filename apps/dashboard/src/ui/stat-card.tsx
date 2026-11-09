/** A summary card: label, amount, optional change against the comparison period, optional link. */
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { changePct } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { Amount, cx } from './primitives';

export function StatCard({
  label,
  fils,
  previousFils,
  hint,
  to,
  search,
  tone = 'default',
  children,
}: {
  label: string;
  fils: number | null | undefined;
  /** The same figure in the comparison period; shows a delta when given. */
  previousFils?: number | null | undefined;
  hint?: ReactNode;
  /** Where the number leads: the list behind it. */
  to?: string | undefined;
  search?: Record<string, string> | undefined;
  tone?: 'default' | 'danger' | 'success' | 'hero';
  children?: ReactNode;
}) {
  const { t, num } = useI18n();
  const delta =
    previousFils === null || previousFils === undefined || fils === null || fils === undefined
      ? null
      : changePct(fils, previousFils);
  const body = (
    <>
      <p
        className={cx(
          'text-[13px] font-medium',
          tone === 'hero' ? 'text-on-hero-soft' : 'text-ink-soft',
        )}
      >
        {label}
      </p>
      <p
        className={cx(
          'mt-1 text-[22px] font-bold',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
          tone === 'hero' && 'text-on-hero',
        )}
      >
        {fils === null || fils === undefined ? (
          <span className={tone === 'hero' ? 'text-on-hero-soft' : 'text-ink-faint'}>—</span>
        ) : (
          <Amount fils={fils} currencyClassName="text-[13px]" />
        )}
      </p>
      {delta !== null ? (
        <p
          className={cx(
            'mt-1 text-[13px] tnum',
            delta >= 0 ? 'text-success' : 'text-danger',
            tone === 'hero' && 'text-on-hero-soft',
          )}
          dir="ltr"
        >
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%{' '}
          <span className={tone === 'hero' ? 'text-on-hero-soft' : 'text-ink-faint'}>
            {t('period_vsPrevious')}
          </span>
        </p>
      ) : previousFils !== undefined &&
        previousFils !== null &&
        fils !== null &&
        fils !== undefined ? (
        <p
          className={cx(
            'mt-1 text-[13px] tnum',
            tone === 'hero' ? 'text-on-hero-soft' : 'text-ink-faint',
          )}
        >
          {t('period_previous')}: {num(previousFils)}
        </p>
      ) : null}
      {/* On the dark hero card the faint grey fails contrast: secondary lines use the hero tokens. */}
      {hint ? (
        <p
          className={cx(
            'mt-1 text-[13px]',
            tone === 'hero' ? 'text-on-hero-soft' : 'text-ink-faint',
          )}
        >
          {hint}
        </p>
      ) : null}
      {children}
    </>
  );
  const classes = cx(
    'block rounded-lg border p-4',
    tone === 'hero'
      ? 'border-hero-line bg-hero text-on-hero'
      : 'border-line bg-elevated shadow-card',
    to && 'hover:bg-sunken',
  );
  if (to) {
    return (
      <Link to={to as never} search={(search ?? {}) as never} className={classes}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
