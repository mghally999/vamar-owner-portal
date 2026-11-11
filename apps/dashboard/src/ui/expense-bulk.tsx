/**
 * Bulk actions on the expense list and the drafts queue: a bar that counts the selection and
 * offers the actions that fit it (post or delete drafts; show or hide posted expenses, admins
 * only), and the confirm dialog. The server applies it all or nothing; when it refuses, the
 * dialog lists each refused expense and why.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MAX_BULK_EXPENSES, type BulkExpenseAction, type ExpenseStatus } from '@vamar/shared';
import { ApiRequestError, request } from '@/lib/api';
import { useExpenseBulkI18n, type ExpenseBulkMessageKey } from '@/lib/expense-bulk-messages';
import type { MessageKey } from '@/lib/messages';
import { keys } from '@/lib/queries';
import { Dialog } from './dialog';
import { Button, Field, Input } from './primitives';

export interface ExpenseBulkRejection {
  id: string;
  invoiceNo: string | null;
  reasonAr: string | null;
  reasonEn: string | null;
  status: ExpenseStatus | null;
  code:
    'not_found' | 'not_draft' | 'not_posted' | 'approval_required' | 'cannot_allocate' | 'refused';
  reason: string;
}

/** The refused expenses carried by a 422 from the bulk endpoint, or null for any other error. */
export function expenseBulkRejections(e: unknown): ExpenseBulkRejection[] | null {
  if (!(e instanceof ApiRequestError) || e.code !== 'invalid_transition') return null;
  const details = e.details as { rejected?: ExpenseBulkRejection[] } | undefined;
  return details?.rejected ?? null;
}

/** All or nothing on the server: one transaction, each expense through its single action. */
export function useBulkExpenseAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; action: BulkExpenseAction; note?: string | undefined }) =>
      request<{ updated: string[]; unchanged: string[]; notified: number }>(
        '/api/staff/expenses/bulk',
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      void qc.invalidateQueries({ queryKey: ['work-order'] });
      void qc.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

/** Post and delete are for drafts; show and hide for posted expenses, and only for admins. */
export function actionsFor(
  statuses: Iterable<ExpenseStatus>,
  canEdit: boolean,
  isAdmin: boolean,
): BulkExpenseAction[] {
  const set = new Set(statuses);
  const out: BulkExpenseAction[] = [];
  if (canEdit && set.has('draft')) out.push('post', 'discard');
  if (isAdmin && set.has('posted')) out.push('show', 'hide');
  return out;
}

const DANGER: Record<BulkExpenseAction, boolean> = {
  post: false,
  discard: true,
  show: false,
  hide: false,
};

export function ExpenseBulkBar({
  count,
  actions,
  onAction,
  onClear,
}: {
  count: number;
  actions: BulkExpenseAction[];
  onAction: (action: BulkExpenseAction) => void;
  onClear: () => void;
}) {
  const { tb } = useExpenseBulkI18n();
  const tooMany = count > MAX_BULK_EXPENSES;
  return (
    <div
      role="region"
      aria-label={tb('expbulk_bar')}
      className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 px-4 py-3"
    >
      <p className="me-auto text-[15px] font-medium" aria-live="polite">
        {tb('expbulk_selected', { n: count })}
        {tooMany ? (
          <span className="block text-[13px] font-normal text-danger">
            {tb('expbulk_tooMany', { max: MAX_BULK_EXPENSES })}
          </span>
        ) : null}
      </p>
      {actions.map((a) => (
        <Button
          key={a}
          size="sm"
          variant={DANGER[a] ? 'danger' : 'secondary'}
          disabled={tooMany}
          onClick={() => {
            onAction(a);
          }}
        >
          {tb(`expbulk_action_${a}`)}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onClear}>
        {tb('expbulk_clear')}
      </Button>
    </div>
  );
}

export function ExpenseBulkDialog({
  action,
  ids,
  labelOf,
  onClose,
  onDone,
  onDeselect,
}: {
  action: BulkExpenseAction;
  ids: string[];
  /** How to name an expense in the refusal list when the server does not carry its reason. */
  labelOf: (id: string) => string;
  onClose: () => void;
  onDone: (updated: number) => void;
  onDeselect: (ids: string[]) => void;
}) {
  const { t, tb, pick } = useExpenseBulkI18n();
  const bulk = useBulkExpenseAction();
  const [note, setNote] = useState('');
  const [rejected, setRejected] = useState<ExpenseBulkRejection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rejectionText = (r: ExpenseBulkRejection) => {
    const status = r.status ? t(`expense_status_${r.status}` as MessageKey) : '';
    return tb(`expbulk_reject_${r.code}` as ExpenseBulkMessageKey, { status });
  };
  const nameOf = (r: ExpenseBulkRejection) =>
    r.reasonAr !== null && r.reasonEn !== null ? pick(r.reasonAr, r.reasonEn) : labelOf(r.id);

  async function submit() {
    setError(null);
    try {
      const r = await bulk.mutateAsync({ ids, action, note: note.trim() || undefined });
      onDone(r.updated.length);
    } catch (e) {
      const list = expenseBulkRejections(e);
      if (list) setRejected(list);
      else setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={tb(`expbulk_title_${action}`, { n: ids.length })}
      description={rejected ? undefined : tb(`expbulk_rules_${action}`)}
      footer={
        rejected ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('close')}
            </Button>
            <Button
              onClick={() => {
                onDeselect(rejected.map((r) => r.id));
                setRejected(null);
              }}
            >
              {tb('expbulk_deselect')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              variant={DANGER[action] ? 'danger' : 'primary'}
              onClick={() => void submit()}
              loading={bulk.isPending}
            >
              {t('confirm')}
            </Button>
          </>
        )
      }
    >
      {rejected ? (
        <div>
          <p className="mb-2 text-[15px] font-medium text-danger" role="alert">
            {tb('expbulk_rejected_title')}
          </p>
          <ul className="flex flex-col text-[15px]">
            {rejected.map((r) => (
              <li
                key={r.id}
                className="row-line flex flex-col gap-1 py-2 last:border-b-0 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-x-3"
              >
                <span className="min-w-0 break-words font-medium" dir="auto">
                  {nameOf(r)}
                  {r.invoiceNo ? (
                    <span className="tnum ms-2 font-normal text-ink-soft" dir="ltr">
                      {r.invoiceNo}
                    </span>
                  ) : null}
                </span>
                <span className="text-ink-soft">{rejectionText(r)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label={tb('expbulk_note')} hint={tb('expbulk_note_hint')}>
            <Input
              value={note}
              maxLength={500}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </Field>
          {error ? (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
