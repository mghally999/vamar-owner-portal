/**
 * Owner approval of a large repair on the work order and expense pages: each owner's answer with
 * their share, note and dates, the overall state, and the admin's override (with a reason that
 * goes to the audit log). Also the list chip, the "awaiting approval" list filter and the check
 * for the API's `approval_required` refusal, so every page words them the same way.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ApprovalState, RepairApprovalStatus } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOverrideApprovals } from '@/lib/queries-v2';
import type { Approvals } from '@/lib/types-v2';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  DateText,
  Field,
  Money,
  SectionTitle,
  Textarea,
  Toast,
  cx,
} from '@/ui/primitives';
import { useApprovalText } from './approvals-messages';

const tone: Record<RepairApprovalStatus | ApprovalState, string> = {
  none: 'bg-chip text-on-chip',
  pending: 'bg-status-upcoming-bg text-status-upcoming',
  rejected: 'bg-status-bounced-bg text-status-bounced',
  approved: 'bg-status-cleared-bg text-status-cleared',
  approved_by_silence: 'bg-status-cleared-bg text-status-cleared',
  overridden: 'bg-chip text-on-chip',
};

const chipClass = 'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium';

/** The one-word state of a job's approvals, for list rows and page headers. */
export function ApprovalStateChip({ state }: { state: ApprovalState }) {
  const { stateLabel } = useApprovalText();
  return <span className={cx(chipClass, tone[state])}>{stateLabel(state)}</span>;
}

function StatusChip({ status }: { status: RepairApprovalStatus }) {
  const { statusLabel } = useApprovalText();
  return <span className={cx(chipClass, tone[status])}>{statusLabel(status)}</span>;
}

/** The API refused a start or a post because an owner's answer is pending or rejected. */
export function isApprovalRequired(e: unknown): boolean {
  return e instanceof ApiRequestError && e.code === 'approval_required';
}

/** The message to show for a refused save: the approval wording, or the API's own message. */
export function useApprovalError() {
  const { t, lib } = useApprovalText();
  return useCallback(
    (e: unknown) =>
      isApprovalRequired(e)
        ? t('approvals_required')
        : e instanceof ApiRequestError
          ? e.message
          : lib('error_generic'),
    [t, lib],
  );
}

/**
 * `approval=awaiting` in the URL, as the Today panel links it, toggled by the list's button so a
 * refresh or a shared link keeps the filter.
 */
export function useAwaitingApprovalFilter(): [boolean, () => void] {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema
  const url = useSearch({ strict: false }) as { approval?: unknown };
  const on = url.approval === 'awaiting';
  const navigate = useNavigate();
  const toggle = useCallback(() => {
    void navigate({
      to: '.',
      replace: true,
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        if (on) delete next['approval'];
        else next['approval'] = 'awaiting';
        return next;
      },
    } as never);
  }, [navigate, on]);
  return [on, toggle];
}

export function AwaitingApprovalToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useApprovalText();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cx(
        'h-9 rounded-md border px-3 text-[14px] font-medium',
        on
          ? 'border-primary bg-primary text-on-primary'
          : 'border-line text-ink-soft hover:bg-sunken',
      )}
    >
      {t('approvals_filter')}
    </button>
  );
}

export function ApprovalsPanel({
  kind,
  id,
  approvals,
}: {
  /** The page's own record; the override goes to it even when the answers are its job's. */
  kind: 'work_order' | 'expense';
  id: string;
  approvals: Approvals;
}) {
  const { t, pick, dateTime, money } = useApprovalText();
  const auth = useAuth();
  const override = useOverrideApprovals();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showError = useApprovalError();

  if (approvals.items.length === 0) return null;
  const canOverride =
    auth.hasRole('admin') && (approvals.state === 'pending' || approvals.state === 'rejected');
  const amountFils = approvals.items[0]?.amountFils ?? 0;

  return (
    <section aria-labelledby={`approvals-${id}`}>
      <SectionTitle
        aside={
          canOverride ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpen(true);
              }}
            >
              {t('approvals_override')}
            </Button>
          ) : null
        }
      >
        <span id={`approvals-${id}`} className="flex flex-wrap items-center gap-2">
          {t('approvals_title')}
          <ApprovalStateChip state={approvals.state} />
        </span>
      </SectionTitle>
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {error ? <Toast kind="error">{error}</Toast> : null}
      <Card className="flex flex-col">
        <p className="row-line flex flex-wrap gap-x-3 px-4 py-3 text-[14px] text-ink-soft">
          <span className="tnum">{t('approvals_askedAbout', { amount: money(amountFils) })}</span>
          {kind === 'expense' && approvals.source === 'work_order' ? (
            <span className="basis-full">{t('approvals_linkedJob')}</span>
          ) : null}
        </p>
        <ul>
          {approvals.items.map((a) => (
            <li key={a.id} className="row-line flex flex-col gap-1 px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium" dir="auto">
                  {pick(a.nameAr, a.nameEn)}
                </span>
                <StatusChip status={a.status} />
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
                <div className="flex gap-1">
                  <dt>{t('approvals_share')}:</dt>
                  <dd>
                    <Money fils={a.shareFils} />
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt>{t('approvals_asked')}:</dt>
                  <dd>
                    <DateText date={a.askedOn} />
                  </dd>
                </div>
                {a.answeredAt ? (
                  <div className="flex gap-1">
                    <dt>{t('approvals_answered')}:</dt>
                    <dd className="tnum">{dateTime(a.answeredAt)}</dd>
                  </div>
                ) : null}
              </dl>
              {a.deadline ? <DeadlineLine date={a.deadline} /> : null}
              {a.note ? (
                <p className="text-[14px]" dir="auto">
                  <span className="text-ink-soft">{t('approvals_note')}: </span>
                  {a.note}
                </p>
              ) : null}
              {a.overriddenAt ? (
                <p className="text-[13px] text-ink-soft" dir="auto">
                  {a.overriddenByName
                    ? t('approvals_overridden', {
                        name: a.overriddenByName,
                        reason: a.overrideReason ?? '',
                      })
                    : t('approvals_overriddenNoName', { reason: a.overrideReason ?? '' })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setReason('');
        }}
        title={t('approvals_override_title')}
        description={t('approvals_override_desc')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('approvals_cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              loading={override.isPending}
              onClick={() => {
                setError(null);
                override
                  .mutateAsync({ kind, id, reason: reason.trim() })
                  .then(() => {
                    setOpen(false);
                    setReason('');
                    setNotice(t('approvals_override_done'));
                  })
                  .catch((e: unknown) => {
                    setOpen(false);
                    setError(showError(e));
                  });
              }}
            >
              {t('approvals_override')}
            </Button>
          </>
        }
      >
        <Field label={t('approvals_override_reason')} hint={t('approvals_override_hint')} required>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
            aria-label={t('approvals_override_reason')}
          />
        </Field>
      </Dialog>
    </section>
  );
}

function DeadlineLine({ date }: { date: string }) {
  const { t, date: fmt } = useApprovalText();
  return (
    <p className="text-[13px] text-ink-soft tnum">{t('approvals_deadline', { date: fmt(date) })}</p>
  );
}
