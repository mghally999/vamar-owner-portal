/** Small pieces the v2 pages share: status chips, the weekend/holiday warning, the timeline. */
import { Link, type LinkProps } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import {
  isPlainDate,
  isWeekend,
  UNIT_STATUS_LABEL,
  type TimelineKind,
  type UnitStatus,
} from '@vamar/shared';
import { Button, Card, Checkbox, cx, Money, Skeleton } from '@/ui/primitives';
import { useV2, v2Messages, type V2MessageKey } from './messages';
import { useHolidays } from './queries';
import type { TimelineEntry } from './types';

/**
 * A link to a route that lives outside the v2 route tree (routes other pages register). The
 * router's type registry does not know every path at build time, so the target is passed through.
 */
export function RouteLink({
  to,
  params,
  className,
  children,
  ...rest
}: {
  to: string;
  params?: Record<string, string> | undefined;
  className?: string | undefined;
  children: ReactNode;
} & Omit<LinkProps, 'to' | 'params' | 'className' | 'children'>) {
  return (
    <Link to={to as never} params={params as never} className={className} {...rest}>
      {children}
    </Link>
  );
}

// Unit status ------------------------------------------------------------------------------------

const statusChip: Record<UnitStatus, string> = {
  occupied: 'bg-status-cleared-bg text-status-cleared',
  vacant_ready: 'bg-status-deposited-bg text-status-deposited',
  under_maintenance: 'bg-status-upcoming-bg text-status-upcoming',
  reserved: 'bg-status-replaced-bg text-status-replaced',
  not_available: 'bg-status-cancelled-bg text-status-cancelled',
};

export function UnitStatusChip({ status, className }: { status: UnitStatus; className?: string }) {
  const { lang } = useV2();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium whitespace-nowrap',
        statusChip[status],
        className,
      )}
    >
      {UNIT_STATUS_LABEL[status][lang]}
    </span>
  );
}

// Weekend / holiday warning ----------------------------------------------------------------------

/** The warning line for a date on a weekend or a public holiday (never a block). */
export function useDateWarning(date: string | null | undefined): string | null {
  const { t, pick } = useV2();
  const year = date && isPlainDate(date) ? Number(date.slice(0, 4)) : undefined;
  const holidays = useHolidays(year);
  if (!date || !isPlainDate(date)) return null;
  const holiday = holidays.data?.find((h) => h.date === date);
  if (holiday) return t('warn_holiday', { name: pick(holiday.nameAr, holiday.nameEn) });
  return isWeekend(date) ? t('warn_weekend') : null;
}

export function DateWarning({ date }: { date: string | null | undefined }) {
  const warning = useDateWarning(date);
  if (!warning) return null;
  return (
    <p role="status" className="mt-1 text-[13px] text-warning">
      {warning}
    </p>
  );
}

// Timeline ---------------------------------------------------------------------------------------

export const TIMELINE_KINDS: TimelineKind[] = [
  'status',
  'contract',
  'tenant',
  'cheque',
  'expense',
  'work_order',
  'dispute',
  'ownership',
];

const kindDot: Record<TimelineKind, string> = {
  status: 'bg-status-upcoming',
  contract: 'bg-primary',
  tenant: 'bg-status-deposited',
  cheque: 'bg-status-cleared',
  expense: 'bg-status-bounced',
  work_order: 'bg-warning',
  dispute: 'bg-danger',
  ownership: 'bg-ink-faint',
};

/** The title of an entry: the API sends a key in titleEn and the subject (name, number) beside it. */
export function timelineTitle(
  e: TimelineEntry,
  t: ReturnType<typeof useV2>['t'],
  lang: 'ar' | 'en',
): string {
  const key = `tl_${e.titleAr === 'status' ? 'status_change' : e.titleAr}` as V2MessageKey;
  const name =
    e.titleAr === 'status'
      ? Object.hasOwn(UNIT_STATUS_LABEL, e.titleEn)
        ? UNIT_STATUS_LABEL[e.titleEn as UnitStatus][lang]
        : e.titleEn
      : e.titleEn;
  // A key this build does not know yet (the API added an event) falls back to the raw key and subject.
  if (!Object.hasOwn(v2Messages.en, key)) return `${e.titleAr} ${e.titleEn}`;
  return t(key, { name, no: name });
}

export function timelineLink(
  e: TimelineEntry,
): { to: string; params: Record<string, string> } | null {
  switch (e.entityType) {
    case 'cheque':
      return { to: '/cheques/$chequeId', params: { chequeId: e.entityId } };
    case 'contract':
      return { to: '/contracts/$contractId', params: { contractId: e.entityId } };
    case 'dispute':
      return { to: '/disputes/$disputeId', params: { disputeId: e.entityId } };
    case 'owner':
      return { to: '/owners/$ownerId', params: { ownerId: e.entityId } };
    case 'expense':
      return { to: '/expenses/$expenseId', params: { expenseId: e.entityId } };
    case 'work_order':
      return { to: '/work-orders/$workOrderId', params: { workOrderId: e.entityId } };
    default:
      return null;
  }
}

export function TimelineKindFilter({
  value,
  onChange,
}: {
  value: TimelineKind[];
  onChange: (kinds: TimelineKind[]) => void;
}) {
  const { t } = useV2();
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
      <legend className="sr-only">{t('records_timelineKinds')}</legend>
      {TIMELINE_KINDS.map((k) => (
        <Checkbox
          key={k}
          label={
            <span className="flex items-center gap-2">
              <span className={cx('inline-block size-2.5 rounded-full', kindDot[k])} aria-hidden />
              {t(`tl_${k}`)}
            </span>
          }
          checked={value.includes(k)}
          onChange={(e) => {
            onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k));
          }}
        />
      ))}
    </fieldset>
  );
}

export function TimelineList({
  items,
  loading,
  hasMore,
  onMore,
  emptyText,
}: {
  items: TimelineEntry[];
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  emptyText: string;
}) {
  const { t, lang, pick, date, dateTime } = useV2();
  if (loading && items.length === 0) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0)
    return <Card className="px-5 py-6 text-[15px] text-ink-soft">{emptyText}</Card>;
  return (
    <div className="flex flex-col gap-3">
      <Card as="div" className="overflow-hidden">
        <ol className="m-0 list-none p-0">
          {items.map((e) => {
            const link = timelineLink(e);
            const title = timelineTitle(e, t, lang);
            const detail = pick(e.detailAr, e.detailEn) || e.detailEn || e.detailAr;
            const timed = e.at.slice(11, 16) !== '04:00';
            return (
              <li key={e.id} className="row-line flex gap-3 px-4 py-3 last:border-b-0">
                <span
                  className={cx(
                    'mt-2 inline-block size-2.5 shrink-0 rounded-full',
                    kindDot[e.kind],
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[15px]">
                    {link ? (
                      <RouteLink
                        to={link.to}
                        params={link.params}
                        className="font-medium hover:underline"
                      >
                        {e.unitNo ? `${e.unitNo} · ` : ''}
                        {title}
                      </RouteLink>
                    ) : (
                      <span className="font-medium">
                        {e.unitNo ? `${e.unitNo} · ` : ''}
                        {title}
                      </span>
                    )}
                    {e.amountFils !== null ? <Money fils={e.amountFils} /> : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-soft">
                    <span className="tnum">{timed ? dateTime(e.at) : date(e.date)}</span>
                    {detail ? (
                      <span dir="auto" className="truncate">
                        {detail}
                      </span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      {hasMore ? (
        <div>
          <Button variant="secondary" size="sm" onClick={onMore} loading={loading}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The entries to show for a paged timeline: when "load more" asks for the next page, what was on
 * screen is kept and the new page is added after it; a filter change starts over. The query keeps
 * the previous page as placeholder data while the next one loads, so the snapshot taken at the
 * moment the page count changes is exactly what was shown. Duplicates (an entry on two pages)
 * appear once.
 */
export function useAccumulatedEntries(
  pages: { kinds: TimelineKind[]; cursors: string[] },
  current: TimelineEntry[] | undefined,
): TimelineEntry[] {
  const [earlier, setEarlier] = useState<TimelineEntry[]>([]);
  const [earlierKey, setEarlierKey] = useState('');
  const key = `${pages.kinds.join(',')}|${String(pages.cursors.length)}`;
  if (earlierKey !== key) {
    setEarlierKey(key);
    setEarlier(pages.cursors.length === 0 ? [] : [...earlier, ...(current ?? [])]);
  }
  const items = pages.cursors.length === 0 ? (current ?? []) : [...earlier, ...(current ?? [])];
  const seen = new Set<string>();
  return items.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/** Pages accumulated over "load more" on top of the kind filter. */
export function useTimelinePages() {
  const [kinds, setKinds] = useState<TimelineKind[]>(TIMELINE_KINDS);
  const [cursors, setCursors] = useState<string[]>([]);
  const filter = useMemo(
    () => ({ kinds: kinds.length === TIMELINE_KINDS.length ? undefined : kinds }),
    [kinds],
  );
  return {
    kinds,
    setKinds: (k: TimelineKind[]) => {
      setKinds(k);
      setCursors([]);
    },
    cursors,
    pushCursor: (c: string) => {
      setCursors((cs) => [...cs, c]);
    },
    filter,
  };
}
