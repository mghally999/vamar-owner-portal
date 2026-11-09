/**
 * Reports, all driven by the period bar and one summary request: owner statement, building P&L,
 * expenses by category, rent collection rate, occupancy over time, outstanding and bounced.
 * Export to Excel (SheetJS) and PDF (print view) in the browser.
 */
import { useMemo, useState } from 'react';
import {
  formatMonth,
  formatPeriod,
  todayInDubai,
  type Period,
  type PlainDate,
} from '@vamar/shared';
import { exportExcel, exportPdf, type ExportSheet } from '@/lib/export';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { usePeriodSearch } from '@/lib/period-search';
import { useBuildings, useCheques } from '@/lib/queries';
import { useHolidaySet, useReportSummary, useSettings } from '@/lib/queries-v2';
import type { ReportSummary } from '@/lib/types-v2';
import { BarChart } from '@/ui/bar-chart';
import { OwnerPicker } from '@/ui/owner-picker';
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
  Select,
  SkeletonRows,
  Toast,
  cx,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import { StatCard } from '@/ui/stat-card';

const REPORTS = [
  'ownerStatement',
  'buildingPnl',
  'byCategory',
  'collectionRate',
  'occupancy',
  'outstanding',
] as const;
type Report = (typeof REPORTS)[number];

export function ReportsPage() {
  const { t, pick, lang, dir, money, num, date } = useI18n();
  const settings = useSettings();
  const period = usePeriodSearch('this_month', settings.data?.weekStart);
  const holidays = useHolidaySet();
  const [report, setReport] = useState<Report>('buildingPnl');
  const [buildingId, setBuildingId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [ownerLabel, setOwnerLabel] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const buildings = useBuildings();
  const needsOwner = report === 'ownerStatement';
  const q = useReportSummary(
    {
      ...period.query,
      buildingId: buildingId || undefined,
      ownerId: needsOwner ? ownerId || undefined : undefined,
    },
    !needsOwner || ownerId !== '',
  );
  const outstanding = useCheques({
    from: period.period.from,
    to: period.period.to,
    buildingId: buildingId || undefined,
    ownerId: needsOwner ? ownerId || undefined : undefined,
    status: 'upcoming,deposited,bounced',
  });
  const d = q.data;
  /** The period the server resolved (authoritative); the browser's own until the answer arrives. */
  const shown: Period = d
    ? { from: d.period.from as PlainDate, to: d.period.to as PlainDate }
    : period.period;
  const periodLabel = formatPeriod(shown, lang);
  const buildingLabel = buildingId
    ? pick(
        buildings.data?.find((b) => b.id === buildingId)?.nameAr ?? '',
        buildings.data?.find((b) => b.id === buildingId)?.nameEn ?? '',
      )
    : t('report_pickBuilding');

  const sheets = useMemo<ExportSheet[]>(() => {
    if (!d) return [];
    const monthName = (k: string) => formatMonth(`${k}-01` as PlainDate, lang);
    const aed = (fils: number) => fils / 100;
    const base: ExportSheet = {
      name: t(`report_${report}` as MessageKey).slice(0, 31),
      rows: [
        [
          t('report_month'),
          t('report_expected'),
          t('report_collected'),
          t('report_outstanding_label'),
          t('report_atRisk'),
          t('overview_fixed'),
          t('overview_variable'),
          t('report_expenses'),
          t('report_net'),
          t('report_rate'),
          t('report_occupied'),
          t('report_totalUnits'),
        ],
        ...d.buckets.map((b) => [
          monthName(b.key),
          aed(b.expectedFils),
          aed(b.collectedFils),
          aed(b.outstandingFils),
          aed(b.atRiskFils),
          aed(b.fixedFils),
          aed(b.variableFils),
          aed(b.totalFils),
          aed(b.netFils),
          b.collectionRatePct,
          b.occupiedUnits,
          b.totalUnits,
        ]),
        [
          t('total'),
          aed(d.rent.expectedFils),
          aed(d.rent.collectedFils),
          aed(d.rent.outstandingFils),
          aed(d.rent.atRiskFils),
          aed(d.expenses.fixedFils),
          aed(d.expenses.variableFils),
          aed(d.expenses.totalFils),
          aed(d.netFils),
          d.rent.collectionRatePct,
          d.occupancy.occupiedUnits,
          d.occupancy.totalUnits,
        ],
      ],
    };
    const categories: ExportSheet = {
      name: t('report_byCategory').slice(0, 31),
      rows: [
        [t('report_category'), t('expense_kind'), t('report_count'), t('amount')],
        ...d.byCategory.map((c) => [
          pick(c.nameAr, c.nameEn),
          t(`expense_kind_${c.kind}`),
          c.count,
          aed(c.totalFils),
        ]),
      ],
    };
    const chequeRows = outstanding.data?.pages.flatMap((p) => p.items) ?? [];
    const outstandingSheet: ExportSheet = {
      name: t('report_outstanding').slice(0, 31),
      rows: [
        [
          t('dueDate'),
          t('building'),
          t('unit'),
          t('tenant'),
          t('cheque_no'),
          t('amount'),
          t('status'),
        ],
        ...chequeRows.map((c) => [
          c.dueDate,
          pick(c.buildingNameAr, c.buildingNameEn),
          c.unitNo,
          c.tenantName,
          c.chequeNo ?? '',
          c.amountFils === null ? null : aed(c.amountFils),
          t(`cheque_status_${c.status}` as MessageKey),
        ]),
      ],
    };
    return report === 'byCategory'
      ? [categories, base]
      : report === 'outstanding'
        ? [outstandingSheet, base]
        : [base, categories];
  }, [d, outstanding.data, report, lang, t, pick]);

  const titleText = `${t(`report_${report}` as MessageKey)}${needsOwner && ownerLabel ? ` · ${ownerLabel}` : ''}`;
  const subtitle = `${periodLabel} · ${buildingLabel} · ${t('report_generated', { date: date(todayInDubai()) })}`;

  return (
    <Page>
      <PageHeader
        title={t('reports_title')}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={!d}
              onClick={() => {
                void exportExcel(`vamar-${report}-${shown.from}-${shown.to}.xlsx`, sheets);
              }}
            >
              {t('report_export_excel')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!d}
              title={t('report_print_hint')}
              onClick={() => {
                if (!exportPdf(titleText, subtitle, sheets, dir)) setNotice(t('error_generic'));
              }}
            >
              {t('report_export_pdf')}
            </Button>
          </>
        }
      />
      {notice ? <Toast kind="error">{notice}</Toast> : null}
      <PeriodBar state={period} holidays={holidays} />
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('reports_title')}>
        {REPORTS.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={report === r}
            onClick={() => {
              setReport(r);
            }}
            className={cx(
              'h-9 rounded-md px-3 text-[14px] font-medium',
              report === r ? 'bg-primary text-on-primary' : 'text-ink-soft hover:bg-sunken',
            )}
          >
            {t(`report_${r}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={buildingId}
          onChange={(e) => {
            setBuildingId(e.target.value);
          }}
          className="w-56"
          aria-label={t('building')}
        >
          <option value="">{t('report_pickBuilding')}</option>
          {buildings.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {pick(b.nameAr, b.nameEn)}
            </option>
          ))}
        </Select>
        {needsOwner ? (
          <OwnerPicker
            value={ownerId}
            onChange={(id, label) => {
              setOwnerId(id);
              setOwnerLabel(label);
            }}
            className="w-72"
          />
        ) : null}
      </div>

      {needsOwner && ownerId === '' ? (
        <EmptyState title={t('report_pickOwner')} />
      ) : q.isPending ? (
        <SkeletonRows cols={5} rows={6} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : d ? (
        <>
          <h2 className="text-heading font-semibold">
            {titleText} <span className="text-[14px] font-normal text-ink-soft">{periodLabel}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('report_expected')}
              fils={d.rent.expectedFils}
              previousFils={d.previous?.rent.expectedFils}
            />
            <StatCard
              label={t('report_collected')}
              fils={d.rent.collectedFils}
              previousFils={d.previous?.rent.collectedFils}
              tone="success"
            />
            <StatCard
              label={t('report_expenses')}
              fils={d.expenses.totalFils}
              previousFils={d.previous?.expenses.totalFils}
            />
            <StatCard
              label={t('report_net')}
              fils={d.netFils}
              previousFils={d.previous?.netFils}
              hint={
                settings.data?.showBeforeFeeLabel === false ? undefined : t('overview_netBeforeFee')
              }
            />
          </div>
          {report === 'collectionRate' || report === 'occupancy' ? (
            <p className="text-[22px] font-bold tnum">
              {report === 'collectionRate'
                ? t('report_pct', { pct: d.rent.collectionRatePct })
                : `${d.occupancy.occupiedUnits} / ${d.occupancy.totalUnits} · ${t('report_pct', { pct: d.occupancy.pct })}`}
              <span className="ms-2 text-[14px] font-normal text-ink-soft">
                {report === 'collectionRate' ? t('report_rate') : t('report_occupied')}
              </span>
            </p>
          ) : null}
          {d.buckets.length > 1 ? (
            <BarChart
              title={t('overview_chart')}
              months={d.buckets.map((b) => b.key)}
              series={
                report === 'occupancy'
                  ? [
                      {
                        key: 'occupied',
                        label: t('report_occupied'),
                        values: d.buckets.map((b) => b.occupiedUnits * 100),
                      },
                    ]
                  : [
                      {
                        key: 'collected',
                        label: t('overview_chart_collected'),
                        values: d.buckets.map((b) => b.collectedFils),
                      },
                      {
                        key: 'expenses',
                        label: t('overview_chart_expenses'),
                        values: d.buckets.map((b) => b.totalFils),
                      },
                      {
                        key: 'expected',
                        label: t('overview_chart_expected'),
                        values: d.buckets.map((b) => b.expectedFils),
                      },
                    ]
              }
            />
          ) : null}
          {report === 'byCategory' ? (
            <CategoryTable d={d} />
          ) : report === 'outstanding' ? (
            <Card className="overflow-hidden">
              {outstanding.isPending ? (
                <SkeletonRows cols={5} rows={4} />
              ) : (
                <ResponsiveTable className="w-full min-w-[720px] text-[15px]">
                  <thead>
                    <tr className="row-line text-[13px] text-ink-soft">
                      <th className="px-4 py-2 text-start font-medium">{t('dueDate')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('unit')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('tenant')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('cheque_no')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(outstanding.data?.pages.flatMap((p) => p.items) ?? []).map((c) => (
                      <tr key={c.id} className="row-line last:border-b-0">
                        <td className="px-4 py-2">
                          <DateText date={c.dueDate} />
                        </td>
                        <td className="px-4 py-2">
                          {pick(c.buildingNameAr, c.buildingNameEn)} · {c.unitNo}
                        </td>
                        <td className="px-4 py-2 text-ink-soft">{c.tenantName}</td>
                        <td className="px-4 py-2 tnum">{c.chequeNo ?? '—'}</td>
                        <td className="px-4 py-2 text-end">
                          <Money fils={c.amountFils} />
                        </td>
                        <td className="px-4 py-2">
                          <ChequeStatusChip status={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              )}
              {outstanding.hasNextPage ? (
                <div className="border-t border-line p-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={outstanding.isFetchingNextPage}
                    onClick={() => void outstanding.fetchNextPage()}
                  >
                    {t('loadMore')}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : (
            <MonthTable d={d} report={report} />
          )}
          <p className="text-[13px] text-ink-faint">
            {d.rent.chequeCount} {t('report_rentRows')} · {d.expenses.count}{' '}
            {t('report_expenseRows')} · {num(d.rent.outstandingFils)}{' '}
            {t('report_outstanding_label')} · {money(d.rent.atRiskFils)} {t('report_atRisk')}
          </p>
        </>
      ) : null}
    </Page>
  );
}

function MonthTable({ d, report }: { d: ReportSummary; report: Report }) {
  const { t, month } = useI18n();
  const occupancy = report === 'occupancy';
  const rate = report === 'collectionRate';
  return (
    <Card className="overflow-hidden">
      <ResponsiveTable className="w-full min-w-[720px] text-[15px]">
        <thead>
          <tr className="row-line text-[13px] text-ink-soft">
            <th className="px-4 py-2 text-start font-medium">{t('report_month')}</th>
            {occupancy ? (
              <>
                <th className="px-4 py-2 text-end font-medium">{t('report_occupied')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('report_totalUnits')}</th>
                <th className="px-4 py-2 text-end font-medium">%</th>
              </>
            ) : (
              <>
                <th className="px-4 py-2 text-end font-medium">{t('report_expected')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('report_collected')}</th>
                {rate ? (
                  <th className="px-4 py-2 text-end font-medium">{t('report_rate')}</th>
                ) : (
                  <>
                    <th className="px-4 py-2 text-end font-medium">{t('report_atRisk')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('overview_fixed')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('overview_variable')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('report_net')}</th>
                  </>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {d.buckets.map((b) => (
            <tr key={b.key} className="row-line last:border-b-0">
              <td className="px-4 py-2">{month(`${b.key}-01`)}</td>
              {occupancy ? (
                <>
                  <td className="px-4 py-2 text-end tnum">{b.occupiedUnits}</td>
                  <td className="px-4 py-2 text-end tnum">{b.totalUnits}</td>
                  <td className="px-4 py-2 text-end tnum">
                    {b.totalUnits === 0 ? 0 : Math.round((100 * b.occupiedUnits) / b.totalUnits)}%
                  </td>
                </>
              ) : (
                <>
                  <td className="px-4 py-2 text-end">
                    <Money fils={b.expectedFils} />
                  </td>
                  <td className="px-4 py-2 text-end">
                    <Money fils={b.collectedFils} />
                  </td>
                  {rate ? (
                    <td className="px-4 py-2 text-end tnum">{b.collectionRatePct}%</td>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-end">
                        <Money fils={b.atRiskFils} />
                      </td>
                      <td className="px-4 py-2 text-end">
                        <Money fils={b.fixedFils} />
                      </td>
                      <td className="px-4 py-2 text-end">
                        <Money fils={b.variableFils} />
                      </td>
                      <td className="px-4 py-2 text-end">
                        <Money fils={b.netFils} strong />
                      </td>
                    </>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </Card>
  );
}

function CategoryTable({ d }: { d: ReportSummary }) {
  const { t, pick } = useI18n();
  return d.byCategory.length === 0 ? (
    <EmptyState title={t('report_empty')} />
  ) : (
    <Card className="overflow-hidden">
      <ResponsiveTable className="w-full min-w-[520px] text-[15px]">
        <thead>
          <tr className="row-line text-[13px] text-ink-soft">
            <th className="px-4 py-2 text-start font-medium">{t('report_category')}</th>
            <th className="px-4 py-2 text-start font-medium">{t('expense_kind')}</th>
            <th className="px-4 py-2 text-end font-medium">{t('report_count')}</th>
            <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {d.byCategory.map((c) => (
            <tr key={c.categoryId} className="row-line last:border-b-0">
              <td className="px-4 py-2">{pick(c.nameAr, c.nameEn)}</td>
              <td className="px-4 py-2 text-ink-soft">{t(`expense_kind_${c.kind}`)}</td>
              <td className="px-4 py-2 text-end tnum">{c.count}</td>
              <td className="px-4 py-2 text-end">
                <Money fils={c.totalFils} />
              </td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </Card>
  );
}
