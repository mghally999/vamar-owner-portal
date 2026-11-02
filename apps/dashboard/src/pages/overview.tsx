import { Link, useNavigate } from '@tanstack/react-router';
import { diffDays, todayInDubai, type PlainDate, occupancyPct } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { usePeriodSearch } from '@/lib/period-search';
import { useOverview, useRenewContract } from '@/lib/queries';
import { useHolidaySet, useReportSummary, useSettings } from '@/lib/queries-v2';
import { BarChart } from '@/ui/bar-chart';
import { PeriodBar } from '@/ui/period-bar';
import {
  Button,
  Card,
  ChequeStatusChip,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { StatCard } from '@/ui/stat-card';

/**
 * Overview: the period bar, the period's money as cards (expected, collected, outstanding, at
 * risk, expenses fixed and variable, net) from the report summary, a rent-versus-expenses chart,
 * then the action lists (bounced, due soon, ending soon, deletion requests). Every card links to
 * the list behind it.
 */
export function OverviewPage() {
  const { t, pick, lang } = useI18n();
  const settings = useSettings();
  const period = usePeriodSearch('this_month', settings.data?.weekStart);
  const holidays = useHolidaySet();
  const summary = useReportSummary(period.query);
  const q = useOverview();
  const auth = useAuth();
  const renew = useRenewContract();
  const navigate = useNavigate();
  const today = todayInDubai();

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  const s = summary.data;
  const prev = s?.previous;
  const periodSearch = period.query;
  const beforeFee =
    settings.data?.showBeforeFeeLabel !== false ? t('overview_netBeforeFee') : undefined;

  return (
    <Page>
      <PageHeader title={t('overview_title')} />
      <PeriodBar state={period} holidays={holidays} />

      {summary.isError ? (
        <ErrorState onRetry={() => void summary.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t('overview_expectedPeriod')}
            fils={s?.rent.expectedFils}
            previousFils={prev?.rent.expectedFils}
            tone="hero"
            to="/cheques"
            search={periodSearch}
            hint={s ? t('overview_cheques_count', { n: s.rent.chequeCount }) : undefined}
          />
          <StatCard
            label={t('overview_collected')}
            fils={s?.rent.collectedFils}
            previousFils={prev?.rent.collectedFils}
            tone="success"
            to="/cheques"
            search={{ ...periodSearch, status: 'cleared' }}
          />
          <StatCard
            label={t('overview_outstanding')}
            fils={s?.rent.outstandingFils}
            previousFils={prev?.rent.outstandingFils}
            to="/cheques"
            search={{ ...periodSearch, status: 'upcoming,deposited' }}
          />
          <StatCard
            label={t('overview_atRisk')}
            fils={s?.rent.atRiskFils}
            previousFils={prev?.rent.atRiskFils}
            tone="danger"
            to="/cheques"
            search={{ ...periodSearch, status: 'bounced' }}
            hint={s ? `${s.rent.bouncedCount} ${t('overview_bounced').toLowerCase()}` : undefined}
          />
          <StatCard
            label={t('overview_expenses')}
            fils={s?.expenses.totalFils}
            previousFils={prev?.expenses.totalFils}
            to="/expenses"
            search={periodSearch}
            hint={
              s ? (
                <span className="tnum">
                  {t('overview_fixed')} <Money fils={s.expenses.fixedFils} /> ·{' '}
                  {t('overview_variable')} <Money fils={s.expenses.variableFils} />
                </span>
              ) : undefined
            }
          />
          <StatCard
            label={t('overview_net')}
            fils={s?.netFils}
            previousFils={prev?.netFils}
            to="/reports"
            search={periodSearch}
            hint={beforeFee}
          />
        </div>
      )}

      {s && s.buckets.length > 1 ? (
        <BarChart
          title={t('overview_chart')}
          months={s.buckets.map((b) => b.key)}
          series={[
            {
              key: 'collected',
              label: t('overview_chart_collected'),
              values: s.buckets.map((b) => b.collectedFils),
            },
            {
              key: 'expenses',
              label: t('overview_chart_expenses'),
              values: s.buckets.map((b) => b.totalFils),
            },
            {
              key: 'expected',
              label: t('overview_chart_expected'),
              values: s.buckets.map((b) => b.expectedFils),
            },
          ]}
        />
      ) : null}

      {d ? (
        <p className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-soft">
          <span>{t('overview_cheques_count', { n: d.chequeCount })}</span>
          <span className="flex min-w-48 flex-1 items-center gap-3">
            <span className="whitespace-nowrap">
              {t('overview_occupancy', {
                occupied: d.occupancy.occupied,
                total: d.occupancy.total,
              })}
            </span>
            <span
              role="progressbar"
              aria-label={t('overview_occupancy', {
                occupied: d.occupancy.occupied,
                total: d.occupancy.total,
              })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={occupancyPct(d.occupancy.occupied, d.occupancy.total)}
              className="h-[7px] max-w-64 flex-1 overflow-hidden rounded-full bg-track"
            >
              <span
                className="block h-full rounded-full bg-track-fill"
                style={{ width: `${occupancyPct(d.occupancy.occupied, d.occupancy.total)}%` }}
              />
            </span>
          </span>
        </p>
      ) : null}

      <section>
        <SectionTitle
          aside={
            <Link
              to="/cheques"
              search={{ status: 'bounced' } as never}
              className="text-[13px] text-ink-soft hover:text-ink"
            >
              {t('viewAll')}
            </Link>
          }
        >
          {t('overview_bouncedList')}
        </SectionTitle>
        {!d ? (
          <ListSkeleton />
        ) : d.bounced.length === 0 ? (
          <EmptyState title={t('overview_bounced_empty')} />
        ) : (
          <ChequeList rows={d.bounced} />
        )}
      </section>

      <section>
        <SectionTitle
          aside={
            <Link to="/cheques" className="text-[13px] text-ink-soft hover:text-ink">
              {t('viewAll')}
            </Link>
          }
        >
          {t('overview_dueSoon')}
        </SectionTitle>
        {!d ? (
          <ListSkeleton />
        ) : d.dueSoon.length === 0 ? (
          <EmptyState title={t('overview_dueSoon_empty')} />
        ) : (
          <ChequeList rows={d.dueSoon} />
        )}
      </section>

      <section>
        <SectionTitle
          aside={
            <Link
              to="/contracts"
              search={{ endingWithinDays: 60 } as never}
              className="text-[13px] text-ink-soft hover:text-ink"
            >
              {t('viewAll')}
            </Link>
          }
        >
          {t('overview_ending')}
        </SectionTitle>
        {!d ? (
          <ListSkeleton />
        ) : d.endingSoon.length === 0 ? (
          <EmptyState title={t('overview_ending_empty')} />
        ) : (
          <Card className="overflow-hidden">
            {d.endingSoon.map((c) => (
              <div
                key={c.id}
                className="row-line flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 last:border-b-0"
              >
                <Link
                  to="/contracts/$contractId"
                  params={{ contractId: c.id }}
                  className="min-w-48 flex-1 font-medium hover:underline"
                >
                  {pick(c.buildingNameAr, c.buildingNameEn)} {c.unitNo}
                </Link>
                <span className="min-w-40 text-ink-soft">{c.tenantName}</span>
                <span className="tnum text-ink-soft">
                  <DateText date={c.endDate} /> ·{' '}
                  {t('endsIn', { n: diffDays(today, c.endDate as PlainDate) })}
                </span>
                <Money fils={c.annualRentFils} />
                {c.hasRenewalDraft ? (
                  <span className="text-[13px] text-status-cleared">
                    {t('overview_renewalReady')}
                  </span>
                ) : auth.hasRole('editor') ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={renew.isPending && renew.variables === c.id}
                    onClick={() =>
                      void renew
                        .mutateAsync(c.id)
                        .then((r) =>
                          navigate({ to: '/contracts/$contractId', params: { contractId: r.id } }),
                        )
                    }
                  >
                    {t('overview_renewNow')}
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </section>

      {d && d.deletionRequests.length > 0 && auth.hasRole('admin') ? (
        <section>
          <SectionTitle>{t('overview_deletion')}</SectionTitle>
          <Card className="overflow-hidden">
            {d.deletionRequests.map((r) => (
              <div
                key={r.id}
                className="row-line flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 last:border-b-0"
              >
                {r.ownerId ? (
                  <Link
                    to="/owners/$ownerId"
                    params={{ ownerId: r.ownerId }}
                    className="flex-1 font-medium hover:underline"
                  >
                    {pick(r.nameAr ?? '', r.nameEn ?? '')}
                  </Link>
                ) : (
                  <span className="flex-1">—</span>
                )}
                <span className="tnum text-ink-soft" dir="ltr">
                  {r.phoneE164}
                </span>
                <span className="tnum text-ink-soft">
                  <WhenText iso={r.at} />
                </span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
      <span className="hidden">{lang}</span>
    </Page>
  );
}

function WhenText({ iso }: { iso: string }) {
  const { dateTime } = useI18n();
  return <>{dateTime(iso)}</>;
}

function ListSkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="row-line flex gap-6 px-4 py-3 last:border-b-0">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </Card>
  );
}

function ChequeList({
  rows,
}: {
  rows: {
    id: string;
    buildingNameAr: string;
    buildingNameEn: string;
    unitNo: string;
    tenantName: string;
    dueDate: string;
    amountFils: number | null;
    status: 'upcoming' | 'deposited' | 'cleared' | 'bounced' | 'replaced' | 'cancelled';
    chequeNo: string | null;
  }[];
}) {
  const { pick } = useI18n();
  return (
    <Card className="overflow-hidden">
      {rows.map((c) => (
        <Link
          key={c.id}
          to="/cheques/$chequeId"
          params={{ chequeId: c.id }}
          className="row-line flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 hover:bg-sunken last:border-b-0"
        >
          <span className="min-w-48 flex-1 font-medium">
            {pick(c.buildingNameAr, c.buildingNameEn)} {c.unitNo}
          </span>
          <span className="min-w-40 text-ink-soft">{c.tenantName}</span>
          <DateText date={c.dueDate} className="text-ink-soft" />
          <Money fils={c.amountFils} />
          <ChequeStatusChip status={c.status} />
        </Link>
      ))}
    </Card>
  );
}
