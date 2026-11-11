/**
 * One expense. A draft shows the form (save, post, delete) and the invoice uploader; a posted
 * expense is read-only with its owners' shares, files, linked work order and dispute, and the
 * admin-only void (with an optional corrected copy); a void one points at its correction.
 */
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import {
  useDeleteExpenseDraft,
  useExpense,
  usePostExpense,
  useUpdateExpense,
  useVoidExpense,
} from '@/lib/queries-v2';
import type { ExpenseDetail } from '@/lib/types-v2';
import { Dialog } from '@/ui/dialog';
import { ExpenseForm, type ExpenseFormValues } from '@/ui/expense-form';
import { FileList } from '@/ui/file-list';
import {
  Button,
  Card,
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
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import { ApprovalStateChip, ApprovalsPanel, useApprovalError } from '@/v2/approvals-panel';
import { ExpenseStatusChip, KindChip } from './expenses';

export function ExpenseDetailPage() {
  const expenseId = useParams({ strict: false }).expenseId ?? '';
  const { t, pick, money, date, dateTime } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const q = useExpense(expenseId);
  const update = useUpdateExpense(expenseId);
  const post = usePostExpense();
  const remove = useDeleteExpenseDraft();
  const voidIt = useVoidExpense();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [withCorrection, setWithCorrection] = useState(false);
  const [correction, setCorrection] = useState<ExpenseFormValues | null>(null);
  const showError = useApprovalError();

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const e = q.data;
  const editor = auth.hasRole('editor');
  // A post refused while an owner's answer is pending or rejected gets the approval wording.
  const fail = (err: unknown) => {
    setError(showError(err));
  };

  const title = e ? pick(e.reasonAr, e.reasonEn) : '';

  return (
    <Page>
      <PageHeader
        title={title}
        subtitle={
          e ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <ExpenseStatusChip status={e.status} />
              <KindChip kind={e.kind} />
              {e.approvals.state !== 'none' ? (
                <ApprovalStateChip state={e.approvals.state} />
              ) : null}
              <span>{pick(e.categoryNameAr, e.categoryNameEn)}</span>
              <span>
                {pick(e.buildingNameAr, e.buildingNameEn)}
                {e.unitNo ? ` · ${e.unitNo}` : ''}
              </span>
              <span className="tnum">
                <DateText date={e.invoiceDate} />
              </span>
              <Money fils={e.totalFils} strong />
              {e.recurringRuleId ? (
                <span className="text-ink-soft">{t('expense_fromRule')}</span>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-5 w-96" />
          )
        }
        actions={
          e && editor && e.status === 'draft' ? (
            <>
              <Button
                onClick={() => {
                  setPosting(true);
                }}
              >
                {t('expense_post')}
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => {
                  remove
                    .mutateAsync(e.id)
                    .then(() => navigate({ to: '/expenses' }))
                    .catch(fail);
                }}
              >
                {t('expense_delete')}
              </Button>
            </>
          ) : e?.status === 'posted' && auth.hasRole('admin') ? (
            <Button
              variant="danger"
              onClick={() => {
                setVoiding(true);
              }}
            >
              {t('expense_void')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {error ? <Toast kind="error">{error}</Toast> : null}

      {e ? <ApprovalsPanel kind="expense" id={e.id} approvals={e.approvals} /> : null}

      {!e ? (
        <Skeleton className="h-64 w-full" />
      ) : e.status === 'draft' && editor ? (
        <>
          {e.recurringRuleId ? (
            <p className="rounded-md bg-status-upcoming-bg px-4 py-3 text-[14px] text-status-upcoming">
              {t('expense_draftFromRule')}
            </p>
          ) : null}
          <ExpenseForm
            initial={e}
            submitLabel={t('save')}
            busy={update.isPending}
            onSubmit={(values) => {
              setError(null);
              update
                .mutateAsync(values)
                .then(() => {
                  setNotice(t('expense_saved'));
                })
                .catch(fail);
            }}
          />
          <section>
            <SectionTitle>{t('expense_files')}</SectionTitle>
            <FileList
              entityType="expense"
              entityId={e.id}
              files={e.attachments}
              canEdit
              uploadLabel={t('expense_upload')}
              emptyLabel={t('expense_noFiles')}
            />
          </section>
        </>
      ) : (
        <ReadOnly e={e} />
      )}

      <Dialog
        open={posting}
        onOpenChange={setPosting}
        title={t('expense_post')}
        description={t('expense_post_confirm')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPosting(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              loading={post.isPending}
              onClick={() => {
                post
                  .mutateAsync(expenseId)
                  .then(() => {
                    setPosting(false);
                    setNotice(t('expense_posted'));
                  })
                  .catch((err: unknown) => {
                    setPosting(false);
                    fail(err);
                  });
              }}
            >
              {t('expense_post')}
            </Button>
          </>
        }
      >
        {e ? (
          <p className="text-[15px]">
            {pick(e.reasonAr, e.reasonEn)} · {money(e.totalFils)}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={voiding}
        onOpenChange={(o) => {
          setVoiding(o);
          if (!o) setCorrection(null);
        }}
        title={t('expense_void')}
        wide
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setVoiding(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3 || (withCorrection && correction === null)}
              loading={voidIt.isPending}
              onClick={() => {
                voidIt
                  .mutateAsync({
                    id: expenseId,
                    reason: reason.trim(),
                    correction: withCorrection && correction ? correction : undefined,
                  })
                  .then((r) => {
                    setVoiding(false);
                    setNotice(t('expense_voided'));
                    if (r.correction)
                      void navigate({
                        to: '/expenses/$expenseId',
                        params: { expenseId: r.correction.expense.id },
                      });
                  })
                  .catch((err: unknown) => {
                    setVoiding(false);
                    fail(err);
                  });
              }}
            >
              {t('expense_void')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={t('expense_void_reason')} required>
            <Textarea
              value={reason}
              onChange={(ev) => {
                setReason(ev.target.value);
              }}
              rows={2}
            />
          </Field>
          <label className="inline-flex items-center gap-2 text-[15px]">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={withCorrection}
              onChange={(ev) => {
                setWithCorrection(ev.target.checked);
              }}
            />
            {t('expense_void_correction')}
          </label>
          {withCorrection && e ? (
            <>
              <p className="text-[13px] text-ink-soft">{t('expense_void_correction_hint')}</p>
              {correction ? (
                <p className="text-[14px] text-status-cleared">
                  {t('expense_correctionSummary', {
                    amount: money(correction.amountFils + correction.vatFils),
                  })}
                </p>
              ) : null}
              <ExpenseForm
                initial={e}
                submitLabel={t('confirm')}
                onSubmit={(values) => {
                  setCorrection(values);
                }}
              />
            </>
          ) : null}
        </div>
      </Dialog>
      <span className="hidden">{e ? dateTime(e.createdAt) : date(null)}</span>
    </Page>
  );
}

function ReadOnly({ e }: { e: ExpenseDetail }) {
  const { t, pick, dateTime } = useI18n();
  return (
    <>
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 text-[15px]">
        <Info label={t('expense_vendor')}>
          {e.vendorName ?? '—'}
          {e.vendorTrn ? (
            <span className="block text-[13px] text-ink-soft tnum">TRN {e.vendorTrn}</span>
          ) : null}
        </Info>
        <Info label={t('expense_invoiceNo')}>
          <span className="tnum">{e.invoiceNo ?? '—'}</span>
        </Info>
        <Info label={t('expense_covers')}>
          {e.coversFrom && e.coversTo ? (
            <span className="tnum">
              <DateText date={e.coversFrom} /> – <DateText date={e.coversTo} />
            </span>
          ) : (
            '—'
          )}
        </Info>
        <Info label={t('expense_amount')}>
          <Money fils={e.amountFils} />
        </Info>
        <Info label={t('expense_vat')}>
          <Money fils={e.vatFils} />
        </Info>
        <Info label={t('expense_total')}>
          <Money fils={e.totalFils} strong />
        </Info>
        <Info label={t('expense_paidOn')}>
          {e.paidOn ? <DateText date={e.paidOn} /> : '—'}
          {e.paymentMethod ? (
            <span className="block text-[13px] text-ink-soft">
              {t(`expense_payment_${e.paymentMethod}` as MessageKey)}
            </span>
          ) : null}
        </Info>
        <Info label={t('expense_allocation')}>
          {t(`expense_allocation_${e.allocationMethod}` as MessageKey)}
        </Info>
        <Info label={t('expense_visibleToOwner')}>{e.visibleToOwner ? t('yes') : t('no')}</Info>
        <Info label={t('expense_postedBy')}>
          {e.postedByName ?? '—'}
          {e.postedAt ? (
            <span className="block text-[13px] text-ink-soft tnum">{dateTime(e.postedAt)}</span>
          ) : null}
        </Info>
        {e.status === 'void' ? (
          <Info label={t('expense_voidedBy')}>
            {e.voidedByName ?? '—'}
            <span className="block text-[13px] text-danger">{e.voidReason}</span>
          </Info>
        ) : null}
        {e.workOrder ? (
          <Info label={t('expense_workOrder')}>
            <Link
              to="/work-orders/$workOrderId"
              params={{ workOrderId: e.workOrder.id }}
              className="hover:underline"
            >
              {pick(e.workOrder.titleAr, e.workOrder.titleEn)}
            </Link>
          </Info>
        ) : null}
        {e.disputeId ? (
          <Info label={t('expense_dispute')}>
            <Link
              to="/disputes/$disputeId"
              params={{ disputeId: e.disputeId }}
              className="tnum hover:underline"
            >
              {e.disputeCaseNo ?? e.disputeId}
            </Link>
          </Info>
        ) : null}
        {e.correctsExpenseId ? (
          <Info label={t('expense_correctsOf')}>
            <Link
              to="/expenses/$expenseId"
              params={{ expenseId: e.correctsExpenseId }}
              className="hover:underline"
            >
              {e.correctsExpenseId.slice(0, 8)}
            </Link>
          </Info>
        ) : null}
        {e.correctedBy ? (
          <Info label={t('expense_correctedBy')}>
            <Link
              to="/expenses/$expenseId"
              params={{ expenseId: e.correctedBy.id }}
              className="hover:underline"
            >
              {e.correctedBy.id.slice(0, 8)}
            </Link>
          </Info>
        ) : null}
      </Card>

      <section>
        <SectionTitle>{t('expense_allocations')}</SectionTitle>
        {e.allocations.length === 0 ? (
          <p className="text-[14px] text-ink-faint">{t('expense_noAllocations')}</p>
        ) : (
          <Card className="overflow-x-auto">
            <ResponsiveTable className="w-full min-w-[480px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="px-4 py-2 text-start font-medium">{t('unit')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('owner')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {e.allocations.map((a) => (
                  <tr key={a.id} className="row-line last:border-b-0">
                    <td className="px-4 py-2 tnum">{a.unitNo}</td>
                    <td className="px-4 py-2">
                      <Link
                        to="/owners/$ownerId"
                        params={{ ownerId: a.ownerId }}
                        className="hover:underline"
                      >
                        {pick(a.nameAr, a.nameEn)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-end">
                      <Money fils={a.amountFils} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>{t('expense_files')}</SectionTitle>
        <FileList
          entityType="expense"
          entityId={e.id}
          files={e.attachments}
          canEdit={false}
          uploadLabel={t('expense_upload')}
          emptyLabel={t('expense_noFiles')}
        />
      </section>
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] text-ink-soft">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}
