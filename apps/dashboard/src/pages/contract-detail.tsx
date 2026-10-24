import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { formatNumber, type PlainDate } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  useActivateContract,
  useContract,
  useRenewContract,
  useTerminateContract,
  useUpdateContract,
} from '@/lib/queries';
import { ChequeGrid, toGridRows, type GridRowDraft } from '@/ui/cheque-grid';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  ChequeStatusChip,
  ContractStatusChip,
  DateText,
  ErrorState,
  Field,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { ResponsiveTable } from '@/ui/responsive-table';

export function ContractDetailPage() {
  const contractId = useParams({ strict: false }).contractId ?? '';
  const { t, pick, lang } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const q = useContract(contractId);
  const update = useUpdateContract(contractId);
  const activate = useActivateContract(contractId);
  const renew = useRenewContract();
  const terminate = useTerminateContract(contractId);
  const [rows, setRows] = useState<GridRowDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ total: number } | null>(null);
  const [reason, setReason] = useState('');
  const [terminating, setTerminating] = useState(false);

  const c = q.data;
  useEffect(() => {
    if (!c) return;
    setRows(
      c.cheques.map((ch) => ({
        seq: ch.seq,
        dueDate: ch.dueDate as PlainDate,
        amountText:
          ch.amountFils === null ? '' : formatNumber(ch.amountFils, 'en').replace(/,/g, ''),
        chequeNo: ch.chequeNo ?? '',
        bankName: ch.bankName ?? '',
        locked: c.status !== 'draft' && ch.status !== 'upcoming',
      })),
    );
    setDirty(false);
  }, [c]);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const editable = auth.hasRole('editor') && (c?.status === 'draft' || c?.status === 'active');

  async function saveGrid() {
    setError(null);
    try {
      await update.mutateAsync({
        cheques: toGridRows(rows).map((g) => ({
          ...g,
          amountFils: g.amountFils && g.amountFils > 0 ? g.amountFils : null,
        })),
      });
      setNotice(t('contract_created'));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  async function doActivate(withReason?: string) {
    setError(null);
    try {
      if (dirty) await update.mutateAsync({ cheques: toGridRows(rows) });
      await activate.mutateAsync(withReason);
      setMismatch(null);
      setNotice(t('contract_activated'));
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'total_mismatch_needs_reason') {
        const d = e.details as { totalFils: number };
        setMismatch({ total: d.totalFils });
      } else setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  return (
    <Page>
      <PageHeader
        title={
          c
            ? `${pick(c.building?.nameAr ?? '', c.building?.nameEn ?? '')} · ${c.unit?.unitNo ?? ''}`
            : ''
        }
        subtitle={
          c ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <ContractStatusChip status={c.status} />
              <span>{c.tenant?.name}</span>
              <span className="tnum">
                <DateText date={c.startDate} /> – <DateText date={c.endDate} />
              </span>
              <Money fils={c.annualRentFils} />
              {c.ejariNo ? <span className="tnum text-ink-soft">Ejari {c.ejariNo}</span> : null}
              {c.previousContractId ? (
                <Link
                  to="/contracts/$contractId"
                  params={{ contractId: c.previousContractId }}
                  className="text-ink-soft hover:underline"
                >
                  {t('contract_previous')}
                </Link>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-5 w-96" />
          )
        }
        actions={
          c && auth.hasRole('editor') ? (
            <>
              {c.status === 'draft' ? (
                <Button onClick={() => void doActivate()} loading={activate.isPending}>
                  {t('contract_activate')}
                </Button>
              ) : null}
              {c.status === 'active' || c.status === 'expired' ? (
                <Button
                  variant="secondary"
                  loading={renew.isPending}
                  onClick={() =>
                    void renew
                      .mutateAsync(c.id)
                      .then((r) =>
                        navigate({ to: '/contracts/$contractId', params: { contractId: r.id } }),
                      )
                  }
                >
                  {t('contract_renew')}
                </Button>
              ) : null}
              {c.status === 'active' ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setTerminating(true);
                  }}
                >
                  {t('contract_terminate')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {error ? <Toast kind="error">{error}</Toast> : null}

      <section>
        <SectionTitle>{t('contract_grid_title')}</SectionTitle>
        {!c ? (
          <Skeleton className="h-64 w-full" />
        ) : c.status === 'draft' ? (
          <>
            <p className="mb-3 text-[13px] text-ink-soft">{t('contract_grid_hint')}</p>
            <ChequeGrid
              rows={rows}
              annualRentFils={c.annualRentFils}
              readOnly={!editable}
              onChange={(r) => {
                setRows(r);
                setDirty(true);
              }}
            />
            {editable ? (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void saveGrid()}
                  disabled={!dirty}
                  loading={update.isPending}
                >
                  {t('contract_saveDraft')}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <Card className="overflow-x-auto">
            <ResponsiveTable className="w-full min-w-[640px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="px-4 py-2 text-start font-medium">#</th>
                  <th className="px-4 py-2 text-start font-medium">{t('dueDate')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('cheque_no')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('cheque_bank')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {c.cheques.map((ch) => (
                  <tr key={ch.id} className="row-line hover:bg-sunken last:border-b-0">
                    <td className="px-4 py-3 tnum text-ink-soft">{ch.seq}</td>
                    <td className="px-4 py-3">
                      <Link
                        to="/cheques/$chequeId"
                        params={{ chequeId: ch.id }}
                        className="hover:underline"
                      >
                        <DateText date={ch.dueDate} />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Money fils={ch.amountFils} />
                    </td>
                    <td className="px-4 py-3 tnum">{ch.chequeNo ?? '—'}</td>
                    <td className="px-4 py-3">{ch.bankName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <ChequeStatusChip status={ch.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </Card>
        )}
      </section>

      {c?.notes ? (
        <section>
          <SectionTitle>{t('notes')}</SectionTitle>
          <Card className="px-5 py-4 text-[15px]">{c.notes}</Card>
        </section>
      ) : null}

      <Dialog
        open={mismatch !== null}
        onOpenChange={(o) => {
          if (!o) setMismatch(null);
        }}
        title={t('contract_mismatch_title')}
        description={
          c && mismatch
            ? t('contract_mismatch_body', {
                total: `${formatNumber(mismatch.total, lang)} ${t('aed')}`,
                rent: `${formatNumber(c.annualRentFils, lang)} ${t('aed')}`,
              })
            : ''
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setMismatch(null);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              disabled={reason.trim().length < 3}
              loading={activate.isPending}
              onClick={() => void doActivate(reason.trim())}
            >
              {t('contract_activate')}
            </Button>
          </>
        }
      >
        <Field label={t('reason')} required>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
          />
        </Field>
      </Dialog>

      <Dialog
        open={terminating}
        onOpenChange={setTerminating}
        title={t('contract_terminate')}
        description={t('contract_terminate_body')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setTerminating(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={terminate.isPending}
              onClick={() => {
                void terminate.mutateAsync(reason.trim()).then(() => {
                  setTerminating(false);
                });
              }}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <Field label={t('reason')} required>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
          />
        </Field>
      </Dialog>
    </Page>
  );
}
