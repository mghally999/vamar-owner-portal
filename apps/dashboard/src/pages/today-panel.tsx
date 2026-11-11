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
import { useApprovalText, type ApprovalMessageKey } from '@/v2/approvals-messages';
import { useBudgetText, type BudgetMessageKey } from '@/v2/budgets-messages';

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
  /** Jobs and expense drafts held back by an owner's pending or rejected answer. */
  ownerApprovals: {
    workOrders: number;
    expenses: number;
    rejected: number;
    silentLast7Days: number;
  };
  /** Building budget lines of this year at 80 % or more (`near`) and at 100 % or more (`over`). */
  budgets: { year: number; near: number; over: number };
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
  /** The dashboard's own copy, or text already worded (the approval copy lives apart). */
  label: MessageKey | { text: string };
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

type ApprovalText = (k: ApprovalMessageKey, v?: Record<string, string | number>) => string;

/**
 * Owner approvals: jobs and drafts waiting, with how many an owner rejected and how many the
 * daily job approved by silence this week. Links to the work orders filter, or to the expenses
 * one when only drafts are waiting.
 */
function approvalsTile(d: StaffToday, ta: ApprovalText): Tile {
  const a = d.ownerApprovals;
  const parts = [
    a.expenses > 0 && a.workOrders > 0 ? ta('today_approvals_expenses', { n: a.expenses }) : null,
    a.rejected > 0 ? ta('today_approvals_rejected', { n: a.rejected }) : null,
    a.silentLast7Days > 0 ? ta('today_approvals_silent', { n: a.silentLast7Days }) : null,
  ].filter((p): p is string => p !== null);
  const onlyExpenses = a.workOrders === 0 && a.expenses > 0;
  return {
    key: 'approvals',
    label: { text: ta('today_approvals') },
    count: a.workOrders + a.expenses,
    urgent: a.rejected > 0,
    detail: parts.length ? <span className="tnum">{parts.join(' · ')}</span> : undefined,
    to: onlyExpenses ? '/expenses' : '/work-orders',
    search: { approval: 'awaiting' },
  };
}

type BudgetText = (k: BudgetMessageKey, v?: Record<string, string | number>) => string;

/**
 * Budget lines past 80 % this year, the used-up ones counted in the detail; red once one is
 * used up. Links to /budgets for that year.
 */
function budgetsTile(d: StaffToday, tb: BudgetText): Tile {
  const b = d.budgets;
  return {
    key: 'budgets',
    label: { text: tb('today_budgets') },
    count: b.near + b.over,
    urgent: b.over > 0,
    detail:
      b.over > 0 ? (
        <span className="tnum">{tb('today_budgets_over', { n: b.over })}</span>
      ) : undefined,
    to: '/budgets',
    search: { year: b.year },
  };
}

function tiles(
  d: StaffToday,
  t: (k: MessageKey, v?: Record<string, string>) => string,
  ta: ApprovalText,
  tb: BudgetText,
): Tile[] {
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
    approvalsTile(d, ta),
    budgetsTile(d, tb),
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
  const { t: ta } = useApprovalText();
  const { t: tb } = useBudgetText();
  const q = useStaffToday();
  const d = q.data;
  const list = d ? tiles(d, t, ta, tb) : [];
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
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
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
                  <span className="text-[14px] font-medium break-words">
                    {typeof x.label === 'string' ? t(x.label) : x.label.text}
                  </span>
                  {(x.count > 0 || x.key === 'approvals') && (x.fils !== undefined || x.detail) ? (
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
