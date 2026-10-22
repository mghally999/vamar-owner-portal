import { Link, useNavigate } from '@tanstack/react-router';
import { diffDays, todayInDubai, type PlainDate, occupancyPct } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';
import { useOverview, useRenewContract } from '@/lib/queries';
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
  Amount,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { useAuth } from '@/lib/auth';

export function OverviewPage() {
  const { t, pick, month } = useI18n();
  const q = useOverview();
  const auth = useAuth();
  const renew = useRenewContract();
  const navigate = useNavigate();
  const today = todayInDubai();

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;

  return (
    <Page>
      <PageHeader
        title={t('overview_title')}
        subtitle={d ? month(`${d.month}-01`) : <Skeleton className="h-5 w-32" />}
      />

      {/* The month's money, as the hero card of the design: expected total, then paid /
          pending / bounced tiles, then the month's cheque count and occupancy. */}
      <section className="rounded-lg border-[0.8px] border-hero-line bg-hero p-5 text-on-hero lg:p-6">
        <p className="text-[14px] font-bold text-on-hero-soft">{t('overview_expected')}</p>
        {d ? (
          <p className="mt-3 text-[35px] leading-[46px] font-extrabold tracking-[-1px]">
            <Amount fils={d.expectedFils} currencyClassName="text-[15px]" />
          </p>
        ) : (
          <div className="skeleton mt-3 h-11 w-64 opacity-30" />
        )}
        <div className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-3">
          {(
            [
              ['overview_cleared', d?.clearedFils, null],
              ['overview_pending', d?.pendingFils, null],
              ['overview_bounced', d?.bouncedFils, d?.bouncedCount],
            ] as const
          ).map(([label, fils, count]) => (
            <div key={label} className="rounded-sm bg-hero-tile p-3">
              <p className="text-[12px] text-on-hero-soft">
                {t(label)}
                {count ? <span className="tnum"> · {count}</span> : null}
              </p>
              <p className="mt-1 text-[17px] font-bold">{d ? <Amount fils={fils ?? 0} /> : '…'}</p>
            </div>
          ))}
        </div>
        {d ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-[13px] text-on-hero-soft">
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
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={occupancyPct(d.occupancy.occupied, d.occupancy.total)}
                className="h-[7px] flex-1 overflow-hidden rounded-full bg-on-hero-soft/40"
              >
                <span
                  className="block h-full rounded-full bg-on-hero"
                  style={{ width: `${occupancyPct(d.occupancy.occupied, d.occupancy.total)}%` }}
                />
              </span>
            </span>
          </div>
        ) : null}
      </section>

      <section>
        <SectionTitle
          aside={
            <Link
              to="/cheques"
              search={{ status: 'bounced' }}
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
              search={{ endingWithinDays: 60 }}
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
                <span className="tnum text-ink-soft">{useI18nDate(r.at)}</span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </Page>
  );
}

function useI18nDate(iso: string) {
  const { dateTime } = useI18n();
  return dateTime(iso);
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
