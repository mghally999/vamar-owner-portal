import { Link, useNavigate } from '@tanstack/react-router';
import { diffDays, todayInDubai, type PlainDate } from '@vamar/shared';
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

      {/* Hero: this month's money. The number is the hero; everything else is quiet. */}
      <Card className="px-6 py-5">
        <p className="text-[13px] font-medium text-ink-soft">{t('overview_expected')}</p>
        {d ? (
          <p className="mt-1 text-hero font-semibold text-primary tnum" dir="ltr">
            {d.expectedFils === 0 ? '—' : <Money fils={d.expectedFils} />}
          </p>
        ) : (
          <Skeleton className="mt-2 h-10 w-64" />
        )}
        {d ? (
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-ink-soft">
            <span>
              {t('overview_cleared')} <Money fils={d.clearedFils} className="text-ink" />
            </span>
            <span>
              {t('overview_pending')} <Money fils={d.pendingFils} className="text-ink" />
            </span>
            <span>
              {t('overview_bounced')}{' '}
              <span className="tnum text-status-bounced">{d.bouncedCount}</span>
            </span>
            <span className="text-ink-faint">
              {t('overview_cheques_count', { n: d.chequeCount })}
            </span>
            <span className="text-ink-faint">
              {t('overview_occupancy', {
                occupied: d.occupancy.occupied,
                total: d.occupancy.total,
              })}
            </span>
          </p>
        ) : (
          <Skeleton className="mt-3 h-4 w-96" />
        )}
      </Card>

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
