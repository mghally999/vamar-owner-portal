import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { CHEQUE_STATUSES } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { usePeriodSearch } from '@/lib/period-search';
import { prefetchCheque, useBuildings, useCheques } from '@/lib/queries';
import { useHolidaySet, useSettings } from '@/lib/queries-v2';
import { PeriodBar } from '@/ui/period-bar';
import type { ChequeRow } from '@/lib/types';
import { OwnerPicker } from '@/ui/owner-picker';
import { StatusDialog } from '@/ui/status-dialog';
import { BulkBar, BulkStatusDialog, type BulkStatus } from '@/ui/cheque-bulk';
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
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { ResponsiveTable } from '@/ui/responsive-table';

export function ChequesPage() {
  const { t, pick } = useI18n();
  const auth = useAuth();
  const qc = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema yet
  const search = useSearch({ strict: false }) as { status?: string };
  const settings = useSettings();
  const period = usePeriodSearch('this_month', settings.data?.weekStart);
  const holidays = useHolidaySet();
  const [status, setStatus] = useState<string>(search.status ?? '');
  const [buildingId, setBuildingId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<BulkStatus | null>(null);
  const [statusFor, setStatusFor] = useState<ChequeRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const buildings = useBuildings();
  const q = useCheques({
    from: period.period.from,
    to: period.period.to,
    buildingId: buildingId || undefined,
    ownerId: ownerId || undefined,
    status: status || undefined,
  });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  // Only the rows in view are in the DOM; a long month stays light however far staff scroll.
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const padTop = virtualRows[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  const editor = auth.hasRole('editor');

  return (
    <Page>
      <PageHeader
        title={t('cheques_title')}
        actions={
          editor ? (
            <Button variant="secondary" asChild>
              <Link to="/cheques/bank-statement">{t('bank_link')}</Link>
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {editor && selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          onAction={setBulkStatus}
          onClear={() => {
            setSelected(new Set());
          }}
        />
      ) : null}
      <PeriodBar state={period} compare={false} holidays={holidays} />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
          className="w-40"
          aria-label={t('cheque_filter_status')}
        >
          <option value="">
            {t('cheque_filter_status')}: {t('all')}
          </option>
          {CHEQUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`cheque_status_${s}` as MessageKey)}
            </option>
          ))}
          {status.includes(',') ? <option value={status}>{status}</option> : null}
        </Select>
        <Select
          value={buildingId}
          onChange={(e) => {
            setBuildingId(e.target.value);
          }}
          className="w-52"
          aria-label={t('cheque_filter_building')}
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
        <OwnerPicker
          value={ownerId}
          onChange={(id) => {
            setOwnerId(id);
          }}
          className="w-64"
        />
      </div>

      {q.isPending ? (
        <SkeletonRows cols={6} rows={8} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('cheques_empty')} />
      ) : (
        <Card className="overflow-hidden">
          <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
            <ResponsiveTable className="w-full min-w-[900px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  {auth.hasRole('editor') ? (
                    <th className="w-12 px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={allSelected}
                        ref={(el) => {
                          // Some but not all rows ticked shows the mixed state.
                          if (el) el.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={() => {
                          setSelected((s) => {
                            const n = new Set(s);
                            for (const r of rows) {
                              if (allSelected) n.delete(r.id);
                              else n.add(r.id);
                            }
                            return n;
                          });
                        }}
                        aria-label={t('all')}
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-2 text-start font-medium">{t('dueDate')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('unit')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tenant')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('cheque_no')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('cheque_bank')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                  {auth.hasRole('editor') ? <th className="px-2 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {padTop > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={9} style={{ height: padTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualRows.map((v) => {
                  const c = rows[v.index];
                  if (!c) return null;
                  return (
                    <tr
                      key={c.id}
                      data-index={v.index}
                      ref={virtualizer.measureElement}
                      className="row-line hover:bg-sunken last:border-b-0"
                      onMouseEnter={() => {
                        prefetchCheque(qc, c.id);
                      }}
                    >
                      {auth.hasRole('editor') ? (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            className="size-5 accent-primary"
                            checked={selected.has(c.id)}
                            onChange={() => {
                              toggle(c.id);
                            }}
                            aria-label={c.chequeNo ?? c.id}
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <Link
                          to="/cheques/$chequeId"
                          params={{ chequeId: c.id }}
                          className="font-medium hover:underline"
                        >
                          <DateText date={c.dueDate} />
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {pick(c.buildingNameAr, c.buildingNameEn)} · {c.unitNo}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{c.tenantName}</td>
                      <td className="px-4 py-3 tnum">{c.chequeNo ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-soft">{c.bankName ?? '—'}</td>
                      <td className="px-4 py-3 text-end">
                        <Money fils={c.amountFils} />
                      </td>
                      <td className="px-4 py-3">
                        <ChequeStatusChip status={c.status} />
                      </td>
                      {auth.hasRole('editor') ? (
                        <td className="px-2 py-3 text-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setStatusFor(c);
                            }}
                          >
                            {t('cheque_changeStatus')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
                {padBottom > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={9} style={{ height: padBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </ResponsiveTable>
          </div>
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

      {statusFor ? (
        <StatusDialog
          cheque={statusFor}
          onClose={() => {
            setStatusFor(null);
          }}
          onDone={() => {
            setStatusFor(null);
            setNotice(t('cheque_statusChanged'));
          }}
        />
      ) : null}
      {bulkStatus ? (
        <BulkStatusDialog
          status={bulkStatus}
          ids={[...selected]}
          labelOf={(id) => rows.find((r) => r.id === id)?.chequeNo ?? id}
          onClose={() => {
            setBulkStatus(null);
          }}
          onDone={(n) => {
            setBulkStatus(null);
            setSelected(new Set());
            setNotice(t('cheque_bulk_done', { n }));
          }}
          onDeselect={(ids) => {
            setBulkStatus(null);
            setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
          }}
        />
      ) : null}
    </Page>
  );
}
