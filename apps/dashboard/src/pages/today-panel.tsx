/**
 * The "Today" panel at the top of the Overview: what needs someone's action today, one tile per
 * kind of work, each a link to the list behind it with the same filter. All figures come from one
 * request (GET /api/staff/today), dated by the server's Dubai day, not the browser's.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { request } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { keys } from '@/lib/queries';
import { Amount, Button, cx, DateText, SectionTitle, Skeleton } from '@/ui/primitives';

export interface StaffToday {
  today: string;
  dueToday: { count: number; amountFils: number };
  dueSoon: { count: number; amountFils: number; from: string; to: string };
  bouncedNoCase: {
    count: number;
    amountFils: number;
    oldestDueDate: string | null;
    newestDueDate: string | null;
  };
  hearings: { count: number; from: string; to: string; next: string | null };
  overdueWorkOrders: { count: number; oldestScheduledFor: string | null };
  expenseDrafts: {
    count: number;
    totalFils: number;
    oldestInvoiceDate: string | null;
    newestInvoiceDate: string | null;
  };
  contractsEnding: { count: number; from: string; to: string };
}

/** Under the overview key, so every change that refreshes the overview refreshes this too. */
export function useStaffToday() {
  return useQuery({
    queryKey: [...keys.overview, 'today'] as const,
    queryFn: () => request<StaffToday>('/api/staff/today'),
    staleTime: 15_000,
  });
}

interface Tile {
  key: string;
  label: MessageKey;
  count: number;
  /** Red when not zero: money already lost or a date already missed. */
  urgent?: boolean;
  fils?: number;
  detail?: ReactNode;
  to: string;
  search: Record<string, string | number>;
}

/** A list filter for a span of dates, or none when there is nothing to span. */
function span(from: string | null, to: string | null): Record<string, string> {
  return from && to ? { from, to } : {};
}

const PENDING = 'upcoming,deposited';

function tiles(d: StaffToday, t: (k: MessageKey, v?: Record<string, string>) => string): Tile[] {
  return [
    {
      key: 'dueToday',
      label: 'today_dueToday',
      count: d.dueToday.count,
      fils: d.dueToday.amountFils,
      to: '/cheques',
      search: { from: d.today, to: d.today, status: PENDING },
    },
    {
      key: 'dueSoon',
      label: 'today_dueSoon',
      count: d.dueSoon.count,
      fils: d.dueSoon.amountFils,
      to: '/cheques',
      search: { from: d.dueSoon.from, to: d.dueSoon.to, status: PENDING },
    },
    {
      key: 'bounced',
      label: 'today_bounced',
      count: d.bouncedNoCase.count,
      urgent: true,
      fils: d.bouncedNoCase.amountFils,
      to: '/cheques',
      search: {
        status: 'bounced',
        ...span(d.bouncedNoCase.oldestDueDate, d.bouncedNoCase.newestDueDate),
      },
    },
    {
      key: 'hearings',
      label: 'today_hearings',
      count: d.hearings.count,
      detail: d.hearings.next ? <When k="today_next" date={d.hearings.next} t={t} /> : undefined,
      to: '/disputes',
      search: { hearingFrom: d.hearings.from, hearingTo: d.hearings.to },
    },
    {
      key: 'overdueWork',
      label: 'today_overdueWork',
      count: d.overdueWorkOrders.count,
      urgent: true,
      detail: d.overdueWorkOrders.oldestScheduledFor ? (
        <When k="today_oldest" date={d.overdueWorkOrders.oldestScheduledFor} t={t} />
      ) : undefined,
      to: '/work-orders',
      search: { overdue: 1 },
    },
    {
      key: 'drafts',
      label: 'today_drafts',
      count: d.expenseDrafts.count,
      fils: d.expenseDrafts.totalFils,
      to: '/expenses',
      search: {
        status: 'draft',
        ...span(d.expenseDrafts.oldestInvoiceDate, d.expenseDrafts.newestInvoiceDate),
      },
    },
    {
      key: 'ending',
      label: 'today_ending',
      count: d.contractsEnding.count,
      to: '/contracts',
      search: { endingWithinDays: 30, withoutRenewal: 1 },
    },
  ];
}

function When({
  k,
  date,
  t,
}: {
  k: MessageKey;
  date: string;
  t: (k: MessageKey, v?: Record<string, string>) => string;
}) {
  const { date: fmt } = useI18n();
  return <span className="tnum">{t(k, { date: fmt(date) })}</span>;
}

export function TodayPanel() {
  const { t } = useI18n();
  const q = useStaffToday();
  const d = q.data;
  const list = d ? tiles(d, t) : [];
  const clear = d !== undefined && list.every((x) => x.count === 0);

  return (
    <section aria-labelledby="today-title">
      <SectionTitle
        aside={d ? <DateText date={d.today} className="text-[13px] text-ink-soft" /> : undefined}
      >
        <span id="today-title">{t('today_title')}</span>
      </SectionTitle>
      {q.isError ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-[15px] text-danger">{t('today_error')}</p>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : !d ? (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <li key={i} className="card p-4">
              <Skeleton className="h-7 w-10" />
              <Skeleton className="mt-2 h-4 w-full" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {clear ? <p className="mb-3 text-[15px] text-ink-soft">{t('today_allClear')}</p> : null}
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {list.map((x) => (
              <li key={x.key} className="min-w-0">
                <Link
                  to={x.to as never}
                  search={x.search as never}
                  className="flex h-full min-w-0 flex-col gap-1 rounded-lg border border-line bg-elevated p-4 shadow-card hover:bg-sunken"
                >
                  <span
                    className={cx(
                      'tnum text-[26px] leading-none font-bold',
                      x.count === 0 ? 'text-ink-soft' : x.urgent ? 'text-danger' : 'text-ink',
                    )}
                  >
                    {x.count}
                  </span>
                  <span className="text-[14px] font-medium break-words">{t(x.label)}</span>
                  {x.count > 0 && (x.fils !== undefined || x.detail) ? (
                    <span className="flex flex-wrap gap-x-2 text-[13px] text-ink-soft">
                      {x.fils !== undefined ? <Amount fils={x.fils} /> : null}
                      {x.detail}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
