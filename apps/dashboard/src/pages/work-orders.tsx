/** Work orders: a filtered list and a board by status, both linking to the detail page. */
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useBuildings } from '@/lib/queries';
import { useWorkOrders } from '@/lib/queries-v2';
import type { WorkOrderRow } from '@/lib/types-v2';
import {
  Button,
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Input,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  cx,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';

const statusChip: Record<WorkOrderStatus, string> = {
  open: 'bg-status-deposited-bg text-status-deposited',
  scheduled: 'bg-status-upcoming-bg text-status-upcoming',
  in_progress: 'bg-status-deposited-bg text-status-deposited',
  done: 'bg-status-cleared-bg text-status-cleared',
  cancelled: 'bg-status-cancelled-bg text-status-cancelled',
};

export function WorkOrderStatusChip({ status }: { status: WorkOrderStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
        statusChip[status],
      )}
    >
      {t(`wo_status_${status}` as MessageKey)}
    </span>
  );
}

export function PriorityChip({ priority }: { priority: WorkOrderPriority }) {
  const { t } = useI18n();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
        priority === 'urgent' ? 'bg-status-bounced-bg text-status-bounced' : 'bg-chip text-on-chip',
      )}
    >
      {t(`wo_priority_${priority}` as MessageKey)}
    </span>
  );
}

export function WorkOrdersPage() {
  const { t, pick } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [buildingId, setBuildingId] = useState('');
  const [status, setStatus] = useState<WorkOrderStatus | ''>('');
  const [priority, setPriority] = useState<WorkOrderPriority | ''>('');
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const buildings = useBuildings();
  const q = useWorkOrders({
    buildingId: buildingId || undefined,
    status: view === 'list' ? status || undefined : undefined,
    priority: priority || undefined,
    search: search || undefined,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <Page>
      <PageHeader
        title={t('workOrders_title')}
        actions={
          auth.hasRole('editor') ? (
            <Button onClick={() => void navigate({ to: '/work-orders/new' })}>
              {t('workOrders_new')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="tablist" aria-label={t('workOrders_title')}>
          {(['list', 'board'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
              }}
              className={cx(
                'h-9 rounded-md px-3 text-[14px] font-medium',
                view === v ? 'bg-primary text-on-primary' : 'text-ink-soft hover:bg-sunken',
              )}
            >
              {t(`workOrders_view_${v}`)}
            </button>
          ))}
        </div>
        <Select
          value={buildingId}
          onChange={(e) => {
            setBuildingId(e.target.value);
          }}
          className="w-52"
          aria-label={t('building')}
        >
          <option value="">
            {t('building')}: {t('all')}
          </option>
          {buildings.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {pick(b.nameAr, b.nameEn)}
            </option>
          ))}
        </Select>
        {view === 'list' ? (
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as WorkOrderStatus | '');
            }}
            className="w-40"
            aria-label={t('status')}
          >
            <option value="">
              {t('status')}: {t('all')}
            </option>
            {WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`wo_status_${s}` as MessageKey)}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value as WorkOrderPriority | '');
          }}
          className="w-40"
          aria-label={t('wo_priority')}
        >
          <option value="">
            {t('wo_priority')}: {t('all')}
          </option>
          {WORK_ORDER_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`wo_priority_${p}` as MessageKey)}
            </option>
          ))}
        </Select>
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder={t('wo_search')}
          aria-label={t('search')}
          className="w-64"
        />
      </div>

      {q.isPending ? (
        <SkeletonRows cols={5} rows={6} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('workOrders_empty')} />
      ) : view === 'board' ? (
        <Board rows={rows} />
      ) : (
        <Card className="overflow-hidden">
          <ResponsiveTable className="w-full min-w-[860px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('wo_reportedOn')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('wo_titleEn')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('building')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('wo_priority')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('wo_scheduledFor')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('wo_cost')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="row-line hover:bg-sunken last:border-b-0">
                  <td className="px-4 py-3">
                    <DateText date={w.reportedOn} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to="/work-orders/$workOrderId"
                      params={{ workOrderId: w.id }}
                      className="font-medium hover:underline"
                    >
                      {pick(w.titleAr, w.titleEn)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {pick(w.buildingNameAr, w.buildingNameEn)}
                    {w.unitNo ? ` · ${w.unitNo}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityChip priority={w.priority} />
                  </td>
                  <td className="px-4 py-3 tnum">
                    {w.scheduledFor ? <DateText date={w.scheduledFor} /> : '—'}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Money fils={w.expenseStatus === 'posted' ? w.expenseTotalFils : null} />
                  </td>
                  <td className="px-4 py-3">
                    <WorkOrderStatusChip status={w.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
          {q.hasNextPage ? (
            <div className="border-t border-line p-3">
              <Button
                variant="secondary"
                size="sm"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
    </Page>
  );
}

function Board({ rows }: { rows: WorkOrderRow[] }) {
  const { t, pick } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
      {WORK_ORDER_STATUSES.map((s) => {
        const items = rows.filter((w) => w.status === s);
        return (
          <section key={s} aria-label={t(`wo_status_${s}` as MessageKey)}>
            <h2 className="mb-2 flex items-center justify-between text-[13px] font-medium text-ink-soft">
              {t(`wo_status_${s}` as MessageKey)}
              <span className="tnum">{items.length}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {items.map((w) => (
                <Link
                  key={w.id}
                  to="/work-orders/$workOrderId"
                  params={{ workOrderId: w.id }}
                  className="card block p-3 hover:bg-sunken"
                >
                  <p className="font-medium" dir="auto">
                    {pick(w.titleAr, w.titleEn)}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-soft">
                    {pick(w.buildingNameAr, w.buildingNameEn)}
                    {w.unitNo ? ` · ${w.unitNo}` : ''}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <PriorityChip priority={w.priority} />
                    <span className="text-[13px] text-ink-soft tnum">
                      {w.scheduledFor ? (
                        <DateText date={w.scheduledFor} />
                      ) : (
                        <DateText date={w.reportedOn} />
                      )}
                    </span>
                  </div>
                </Link>
              ))}
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-line p-3 text-center text-[13px] text-ink-faint">
                  —
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
