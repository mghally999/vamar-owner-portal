import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import {
  addMonthsClamped,
  CHEQUE_STATUSES,
  todayInDubai,
  type ChequeStatus,
  type PlainDate,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { prefetchCheque, useBuildings, useBulkChequeStatus, useCheques } from '@/lib/queries';
import type { ChequeRow } from '@/lib/types';
import { OwnerPicker } from '@/ui/owner-picker';
import { StatusDialog } from '@/ui/status-dialog';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  ChequeStatusChip,
  Checkbox,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function ChequesPage() {
  const { t, pick, month: monthLabel } = useI18n();
  const auth = useAuth();
  const qc = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema yet
  const search = useSearch({ strict: false }) as { status?: string };
  const [monthDate, setMonthDate] = useState<PlainDate | null>(
    () => `${todayInDubai().slice(0, 7)}-01` as PlainDate,
  );
  const [status, setStatus] = useState<string>(search.status ?? '');
  const [buildingId, setBuildingId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [statusFor, setStatusFor] = useState<ChequeRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const buildings = useBuildings();
  const month = monthDate ? monthDate.slice(0, 7) : undefined;
  const q = useCheques({
    month,
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

  return (
    <Page>
      <PageHeader
        title={t('cheques_title')}
        actions={
          auth.hasRole('editor') && selected.size > 0 ? (
            <Button
              onClick={() => {
                setBulkOpen(true);
              }}
            >
              {t('cheque_bulk')} · {t('cheque_selected', { n: selected.size })}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 items-center rounded-md border border-line-strong bg-elevated">
          <button
            type="button"
            className="flex size-11 items-center justify-center"
            aria-label={t('prevMonth')}
            onClick={() => {
              setMonthDate(
                monthDate
                  ? addMonthsClamped(monthDate, -1)
                  : (`${todayInDubai().slice(0, 7)}-01` as PlainDate),
              );
            }}
          >
            <ChevronRight className="size-5 ltr:hidden" />
            <ChevronLeft className="size-5 rtl:hidden" />
          </button>
          <button
            type="button"
            className="min-w-36 px-2 text-center text-[15px] font-medium tnum"
            onClick={() => {
              setMonthDate(monthDate ? null : (`${todayInDubai().slice(0, 7)}-01` as PlainDate));
            }}
          >
            {monthDate ? monthLabel(monthDate) : t('all')}
          </button>
          <button
            type="button"
            className="flex size-11 items-center justify-center"
            aria-label={t('nextMonth')}
            onClick={() => {
              setMonthDate(
                monthDate
                  ? addMonthsClamped(monthDate, 1)
                  : (`${todayInDubai().slice(0, 7)}-01` as PlainDate),
              );
            }}
          >
            <ChevronLeft className="size-5 ltr:hidden" />
            <ChevronRight className="size-5 rtl:hidden" />
          </button>
        </div>
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
            <table className="w-full min-w-[900px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  {auth.hasRole('editor') ? (
                    <th className="w-12 px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={allSelected}
                        onChange={() => {
                          setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
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
            </table>
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
      <BulkDialog
        open={bulkOpen}
        ids={[...selected]}
        rows={rows}
        onClose={() => {
          setBulkOpen(false);
        }}
        onDone={(msg) => {
          setBulkOpen(false);
          setSelected(new Set());
          setNotice(msg);
        }}
      />
    </Page>
  );
}

function BulkDialog({
  open,
  ids,
  rows,
  onClose,
  onDone,
}: {
  open: boolean;
  ids: string[];
  rows: ChequeRow[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { t } = useI18n();
  const bulk = useBulkChequeStatus();
  const [to, setTo] = useState<ChequeStatus>('deposited');
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<{ id: string; reason: string }[] | null>(null);

  async function submit() {
    const r = await bulk.mutateAsync({ chequeIds: ids, to, note });
    if (r.failed.length) setFailed(r.failed);
    else onDone(t('cheque_bulk_result', { ok: r.ok.length, failed: 0 }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('cheque_bulk')}
      description={t('cheque_selected', { n: ids.length })}
      footer={
        failed ? (
          <Button
            onClick={() => {
              onDone(
                t('cheque_bulk_result', { ok: ids.length - failed.length, failed: failed.length }),
              );
            }}
          >
            {t('close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void submit()}
              loading={bulk.isPending}
              disabled={to === 'bounced' && note.trim().length === 0}
            >
              {t('confirm')}
            </Button>
          </>
        )
      }
    >
      {failed ? (
        <div>
          <p className="mb-2 text-[15px] font-medium">{t('cheque_bulk_failed_title')}</p>
          <ul className="flex flex-col gap-1 text-[15px]">
            {failed.map((f) => {
              const row = rows.find((r) => r.id === f.id);
              return (
                <li key={f.id} className="row-line flex justify-between gap-3 py-2 last:border-b-0">
                  <span className="tnum">{row?.chequeNo ?? f.id}</span>
                  <span className="text-danger">{f.reason}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Select
            value={to}
            onChange={(e) => {
              setTo(e.target.value as ChequeStatus);
            }}
            aria-label={t('status')}
          >
            {(['deposited', 'cleared', 'bounced', 'cancelled'] as ChequeStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(`cheque_status_${s}` as MessageKey)}
              </option>
            ))}
          </Select>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">
              {to === 'bounced' ? t('cheque_bounceReason') : t('cheque_note')}
            </span>
            <Textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              rows={2}
            />
          </label>
          <Checkbox label={t('confirm')} checked readOnly className="hidden" />
        </div>
      )}
    </Dialog>
  );
}
