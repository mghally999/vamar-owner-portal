/**
 * Change one cheque's status. Offers only the legal transitions from the shared state machine;
 * bounce asks for a reason; replace asks for the replacement cheque; admins may correct a
 * terminal status with a reason.
 */
import { useState } from 'react';
import {
  CHEQUE_TRANSITIONS,
  isTerminalChequeStatus,
  parseAmountInput,
  type ChequeStatus,
  type PlainDate,
} from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useChangeChequeStatus, type StatusChangeInput } from '@/lib/queries';
import { Dialog } from './dialog';
import { Button, ChequeStatusChip, Field, Input, Select, Textarea } from './primitives';

interface ChequeLike {
  id: string;
  status: ChequeStatus;
  chequeNo: string | null;
  amountFils: number | null;
  dueDate: string;
  bankName: string | null;
}

const ACTION_LABEL: Record<ChequeStatus, MessageKey> = {
  deposited: 'cheque_markDeposited',
  cleared: 'cheque_markCleared',
  bounced: 'cheque_markBounced',
  cancelled: 'cheque_markCancelled',
  replaced: 'cheque_replace',
  upcoming: 'cheque_status_upcoming',
};

export function StatusDialog({
  cheque,
  onClose,
  onDone,
}: {
  cheque: ChequeLike;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const auth = useAuth();
  const change = useChangeChequeStatus();
  const terminal = isTerminalChequeStatus(cheque.status);
  const override = terminal && auth.hasRole('admin');
  const options: ChequeStatus[] = override
    ? (['upcoming', 'deposited', 'cleared', 'bounced', 'cancelled'] as ChequeStatus[]).filter(
        (s) => s !== cheque.status,
      )
    : [...CHEQUE_TRANSITIONS[cheque.status]];
  const [to, setTo] = useState<ChequeStatus | ''>(options.length === 1 ? (options[0] ?? '') : '');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [rep, setRep] = useState({
    dueDate: cheque.dueDate as PlainDate,
    amount: cheque.amountFils ? String(cheque.amountFils / 100) : '',
    chequeNo: '',
    bankName: cheque.bankName ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  const repAmount = parseAmountInput(rep.amount);
  const needsReplacement = to === 'replaced';
  const needsReason = to === 'bounced';
  const canSubmit =
    to !== '' &&
    (!needsReason || reason.trim().length > 0) &&
    (!override || reason.trim().length >= 3) &&
    (!needsReplacement ||
      (repAmount !== null && repAmount > 0 && rep.chequeNo.trim() && rep.bankName.trim()));

  async function submit() {
    if (to === '') return;
    setError(null);
    const input: StatusChangeInput = { to, note: note.trim() || undefined };
    if (needsReason) input.bounceReason = reason.trim();
    if (override) input.overrideReason = reason.trim();
    if (needsReplacement && repAmount)
      input.replacement = {
        dueDate: rep.dueDate,
        amountFils: repAmount,
        chequeNo: rep.chequeNo.trim(),
        bankName: rep.bankName.trim(),
      };
    try {
      await change.mutateAsync({ id: cheque.id, input });
      onDone();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('cheque_changeStatus')}
      description={
        <span className="flex items-center gap-2">
          <span className="tnum">{cheque.chequeNo ?? '—'}</span>
          <ChequeStatusChip status={cheque.status} />
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} loading={change.isPending}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      {terminal && !override ? (
        <p className="text-[15px] text-ink-soft">{t('cheque_adminOverride_hint')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {override ? (
            <p className="rounded-md bg-status-deposited-bg px-3 py-2 text-[13px] text-status-deposited">
              {t('cheque_adminOverride_hint')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('status')}>
            {options.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={to === s}
                onClick={() => {
                  setTo(s);
                }}
                className={`h-11 rounded-md border px-4 text-[15px] font-medium ${to === s ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-elevated hover:bg-sunken'}`}
              >
                {t(ACTION_LABEL[s])}
              </button>
            ))}
          </div>
          {needsReason || override ? (
            <Field
              label={override ? t('cheque_adminOverride') : t('cheque_bounceReason')}
              required
              hint={needsReason ? t('cheque_bounceReason_hint') : undefined}
            >
              <Textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
                rows={2}
              />
            </Field>
          ) : null}
          {needsReplacement ? (
            <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
              <legend className="px-1 text-[13px] font-medium text-ink-soft">
                {t('cheque_replacement')}
              </legend>
              <Field label={t('dueDate')} required>
                <Input
                  type="date"
                  value={rep.dueDate}
                  onChange={(e) => {
                    setRep({ ...rep, dueDate: e.target.value as PlainDate });
                  }}
                  numeric
                />
              </Field>
              <Field label={`${t('amount')} (${t('aed')})`} required>
                <Input
                  value={rep.amount}
                  onChange={(e) => {
                    setRep({ ...rep, amount: e.target.value });
                  }}
                  numeric
                  inputMode="decimal"
                />
              </Field>
              <Field label={t('cheque_no')} required>
                <Input
                  value={rep.chequeNo}
                  onChange={(e) => {
                    setRep({ ...rep, chequeNo: e.target.value });
                  }}
                  numeric
                />
              </Field>
              <Field label={t('cheque_bank')} required>
                <Input
                  value={rep.bankName}
                  onChange={(e) => {
                    setRep({ ...rep, bankName: e.target.value });
                  }}
                />
              </Field>
            </fieldset>
          ) : null}
          <Field label={t('cheque_note')}>
            <Input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </Field>
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        </div>
      )}
      <Select className="hidden" aria-hidden tabIndex={-1} />
    </Dialog>
  );
}
