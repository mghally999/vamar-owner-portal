/**
 * Bulk status change on the cheque list: a bar that counts the selection and offers the three
 * bank moves plus cancel, and the dialog that asks for the bank's date (and a reason for bounces;
 * a cancel needs neither, as with a single cancel). The server applies it all or nothing; when it
 * refuses, the dialog lists each refused cheque and why.
 */
import { useState } from 'react';
import { MAX_BULK_CHEQUES, todayInDubai, type PlainDate } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import {
  bulkRejections,
  useBulkChequeStatus,
  type BulkRejection,
  type BulkStatusInput,
} from '@/lib/queries';
import { useHolidaySet } from '@/lib/queries-v2';
import { DatePicker } from './date-picker';
import { Dialog } from './dialog';
import { Button, Field, Input, Textarea } from './primitives';

export type BulkStatus = BulkStatusInput['status'];

const ACTION: Record<BulkStatus, MessageKey> = {
  deposited: 'cheque_markDeposited',
  cleared: 'cheque_markCleared',
  bounced: 'cheque_markBounced',
  cancelled: 'cheque_markCancelled',
};

const DATE_LABEL: Record<Exclude<BulkStatus, 'cancelled'>, MessageKey> = {
  deposited: 'cheque_bulk_date_deposited',
  cleared: 'cheque_bulk_date_cleared',
  bounced: 'cheque_bulk_date_bounced',
};

export const BOUNCE_REASON_KEYS: MessageKey[] = [
  'bounce_reason_funds',
  'bounce_reason_signature',
  'bounce_reason_closed',
  'bounce_reason_stopped',
  'bounce_reason_returned',
];

/** Quick picks for the bounce reason; staff can still type their own. */
export function BounceReasonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <Field label={t('cheque_bounceReason')} required hint={t('cheque_bounceReason_hint')}>
        <Textarea
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          rows={2}
        />
      </Field>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('cheque_bounceReason_common')}
      >
        {BOUNCE_REASON_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={value === t(k)}
            onClick={() => {
              onChange(t(k));
            }}
            className={`min-h-9 rounded-full border px-3 text-[13px] ${value === t(k) ? 'border-primary bg-primary text-on-primary' : 'border-line-strong bg-elevated hover:bg-sunken'}`}
          >
            {t(k)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One line per refused cheque, in the staff member's language. */
export function useRejectionText() {
  const { t } = useI18n();
  return (r: BulkRejection, to: BulkStatus) =>
    r.code === 'invalid_transition' && r.from
      ? t('cheque_bulk_reject_invalid_transition', {
          from: t(`cheque_status_${r.from}` as MessageKey),
          to: t(`cheque_status_${to}` as MessageKey),
        })
      : t(`cheque_bulk_reject_${r.code}` as MessageKey);
}

export function BulkBar({
  count,
  onAction,
  onClear,
}: {
  count: number;
  onAction: (status: BulkStatus) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const tooMany = count > MAX_BULK_CHEQUES;
  return (
    <div
      role="region"
      aria-label={t('cheque_bulk_bar')}
      className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 px-4 py-3"
    >
      <p className="me-auto text-[15px] font-medium" aria-live="polite">
        {t('cheque_selected', { n: count })}
        {tooMany ? (
          <span className="block text-[13px] font-normal text-danger">
            {t('cheque_bulk_tooMany', { max: MAX_BULK_CHEQUES })}
          </span>
        ) : null}
      </p>
      {(Object.keys(ACTION) as BulkStatus[]).map((s) => (
        <Button
          key={s}
          size="sm"
          variant={s === 'bounced' || s === 'cancelled' ? 'danger' : 'secondary'}
          disabled={tooMany}
          onClick={() => {
            onAction(s);
          }}
        >
          {t(ACTION[s])}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t('cheque_bulk_clear')}
      </Button>
    </div>
  );
}

export function BulkStatusDialog({
  status,
  ids,
  labelOf,
  onClose,
  onDone,
  onDeselect,
}: {
  status: BulkStatus;
  ids: string[];
  /** How to name a cheque in the refusal list (its number, else its id). */
  labelOf: (id: string) => string;
  onClose: () => void;
  onDone: (updated: number) => void;
  onDeselect: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const bulk = useBulkChequeStatus();
  const holidays = useHolidaySet();
  const today = todayInDubai();
  const rejectionText = useRejectionText();
  const [date, setDate] = useState<PlainDate | null>(today);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [rejected, setRejected] = useState<BulkRejection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsDate = status !== 'cancelled';
  const future = needsDate && date !== null && date > today;
  const canSubmit =
    (!needsDate || date !== null) && !future && (status !== 'bounced' || reason.trim().length > 0);

  async function submit() {
    if (needsDate && !date) return;
    setError(null);
    try {
      const r = await bulk.mutateAsync({
        ids,
        status,
        date: needsDate ? (date ?? undefined) : undefined,
        reason: status === 'bounced' ? reason.trim() : undefined,
        note: note.trim() || undefined,
      });
      onDone(r.updated.length);
    } catch (e) {
      const list = bulkRejections(e);
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
      title={t('cheque_bulk_title', { status: t(ACTION[status]), n: ids.length })}
      description={rejected ? undefined : t('cheque_bulk_rules')}
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
              {t('cheque_bulk_deselect')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void submit()} disabled={!canSubmit} loading={bulk.isPending}>
              {t('confirm')}
            </Button>
          </>
        )
      }
    >
      {rejected ? (
        <div>
          <p className="mb-2 text-[15px] font-medium text-danger" role="alert">
            {t('cheque_bulk_rejected_title')}
          </p>
          <ul className="flex flex-col text-[15px]">
            {rejected.map((r) => (
              <li
                key={r.id}
                className="row-line flex flex-wrap justify-between gap-x-3 gap-y-1 py-2 last:border-b-0"
              >
                <span className="tnum" dir="ltr">
                  {r.chequeNo ?? labelOf(r.id)}
                </span>
                <span className="text-ink-soft">{rejectionText(r, status)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {status !== 'cancelled' ? (
            <Field
              label={t(DATE_LABEL[status])}
              required
              error={future ? t('cheque_bulk_date_future') : undefined}
            >
              <DatePicker
                value={date}
                onChange={setDate}
                max={today}
                holidays={holidays}
                invalid={future}
                aria-label={t(DATE_LABEL[status])}
              />
            </Field>
          ) : null}
          {status === 'bounced' ? <BounceReasonField value={reason} onChange={setReason} /> : null}
          <Field label={t('cheque_note')}>
            <Input
              value={note}
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
