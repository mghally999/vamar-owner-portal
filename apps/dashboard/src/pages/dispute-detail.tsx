import { Link, useParams } from '@tanstack/react-router';
import { Paperclip, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  DISPUTE_STATUSES,
  DISPUTE_STATUS_LABEL,
  DISPUTE_TYPE_LABEL,
  type PlainDate,
} from '@vamar/shared';
import { getAccessToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import {
  useAddDisputeUpdate,
  useDeleteAttachment,
  useDispute,
  useUpdateDispute,
  useUploadAttachment,
} from '@/lib/queries';
import {
  Button,
  Card,
  Checkbox,
  ChequeStatusChip,
  DateText,
  DisputeStatusChip,
  ErrorState,
  Field,
  Money,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { DatePicker } from '@/ui/date-picker';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Dialog } from '@/ui/dialog';
import { ChequePicker } from '@/v2/cheque-picker';
import { useV2 } from '@/v2/messages';
import {
  useDisputeExpenses,
  useHolidays,
  useSetDisputeCheques,
  useUnitCheques,
} from '@/v2/queries';
import { RouteLink } from '@/v2/shared';
import type { DisputeDetailV2 } from '@/v2/types';

export function DisputeDetailPage() {
  const disputeId = useParams({ strict: false }).disputeId ?? '';
  const { t, pick, lang, dateTime } = useI18n();
  const { t: tv2 } = useV2();
  const auth = useAuth();
  const q = useDispute(disputeId);
  const fees = useDisputeExpenses(disputeId);
  const [linking, setLinking] = useState(false);
  const update = useUpdateDispute(disputeId);
  const addUpdate = useAddDisputeUpdate(disputeId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment(disputeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const hearingYear = Number((hearing ?? q.data?.nextHearingDate ?? '').slice(0, 4)) || undefined;
  const holidays = useHolidays(hearingYear);
  const holidaySet = useMemo(
    () => new Set((holidays.data ?? []).map((h) => h.date)),
    [holidays.data],
  );

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data as DisputeDetailV2 | undefined;
  const canEdit = auth.hasRole('editor');
  const linkedCheques = d?.cheques ?? [];

  async function openAttachment(id: string) {
    const res = await fetch(`/api/staff/attachments/${id}`, {
      headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
    });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
  }

  return (
    <Page>
      <PageHeader
        title={d ? `${t('dispute_case')} ${d.caseNo}` : ''}
        subtitle={
          d ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <DisputeStatusChip status={d.status} />
              <span>{DISPUTE_TYPE_LABEL[d.type][lang]}</span>
              <span>
                {pick(d.building?.nameAr ?? '', d.building?.nameEn ?? '')} · {d.unit?.unitNo}
              </span>
              {d.tenant ? <span>{d.tenant.name}</span> : null}
              {d.contractId ? (
                <Link
                  to="/contracts/$contractId"
                  params={{ contractId: d.contractId }}
                  className="hover:underline"
                >
                  {t('contract')}
                </Link>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-5 w-80" />
          )
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}

      <Card className="grid gap-4 px-6 py-5 sm:grid-cols-4">
        <div>
          <p className="text-[13px] text-ink-soft">{t('dispute_claimed')}</p>
          {d ? (
            <p className="text-heading font-semibold">
              <Money fils={d.amountClaimedFils} />
            </p>
          ) : (
            <Skeleton className="mt-2 h-7 w-32" />
          )}
        </div>
        <div>
          <p className="text-[13px] text-ink-soft">{t('dispute_opened')}</p>
          {d ? (
            <p className="text-[15px] tnum">{dateTime(d.openedAt)}</p>
          ) : (
            <Skeleton className="mt-2 h-5 w-32" />
          )}
        </div>
        <div>
          <p className="text-[13px] text-ink-soft">{t('dispute_hearing')}</p>
          {d ? (
            canEdit ? (
              <DatePicker
                aria-label={t('dispute_hearing')}
                value={(hearing ?? d.nextHearingDate ?? '') as PlainDate | ''}
                onChange={(next) => {
                  setHearing(next ?? '');
                  if ((next ?? '') !== (d.nextHearingDate ?? ''))
                    update.mutate({ nextHearingDate: next });
                }}
                clearable
                warnNonWorking
                holidays={holidaySet}
              />
            ) : (
              <p className="text-[15px]">
                <DateText date={d.nextHearingDate} />
              </p>
            )
          ) : (
            <Skeleton className="mt-2 h-5 w-32" />
          )}
        </div>
        <div>
          <p className="text-[13px] text-ink-soft">{t('status')}</p>
          {d ? (
            canEdit ? (
              <Select
                value={d.status}
                onChange={(e) => {
                  update.mutate({ status: e.target.value });
                }}
                className="h-10"
              >
                {DISPUTE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DISPUTE_STATUS_LABEL[s][lang]}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-[15px]">{DISPUTE_STATUS_LABEL[d.status][lang]}</p>
            )
          ) : (
            <Skeleton className="mt-2 h-5 w-24" />
          )}
        </div>
      </Card>

      <section>
        <SectionTitle
          aside={
            canEdit && d ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setLinking(true);
                }}
              >
                {tv2('disputes_linkCheques')}
              </Button>
            ) : null
          }
        >
          {tv2('disputes_linkedCheques')}
        </SectionTitle>
        {!d ? (
          <Skeleton className="h-24 w-full" />
        ) : linkedCheques.length === 0 ? (
          <Card className="px-5 py-6 text-[15px] text-ink-soft">
            {tv2('disputes_noCheques')}
            {d.type === 'bounced_cheque' ? ` ${tv2('disputes_needCheque')}` : ''}
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <ResponsiveTable className="w-full min-w-[760px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="px-4 py-2 text-start font-medium">{tv2('disputes_chequeNos')}</th>
                  <th className="px-4 py-2 text-start font-medium">{tv2('disputes_bank')}</th>
                  <th className="px-4 py-2 text-end font-medium">{tv2('amount')}</th>
                  <th className="px-4 py-2 text-start font-medium">{tv2('disputes_due')}</th>
                  <th className="px-4 py-2 text-start font-medium">{tv2('disputes_bounced')}</th>
                  <th className="px-4 py-2 text-start font-medium">
                    {tv2('disputes_bounceReason')}
                  </th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {linkedCheques.map((c) => (
                  <tr key={c.id} className="row-line last:border-b-0">
                    <td className="px-4 py-3 tnum" dir="ltr">
                      <Link
                        to="/cheques/$chequeId"
                        params={{ chequeId: c.id }}
                        className="font-medium hover:underline"
                        aria-label={`${tv2('disputes_openCheque')} ${c.chequeNo ?? ''}`}
                      >
                        {c.chequeNo ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{c.bankName ?? '—'}</td>
                    <td className="px-4 py-3 text-end">
                      <Money fils={c.amountFils} />
                    </td>
                    <td className="px-4 py-3">
                      <DateText date={c.dueDate} />
                    </td>
                    <td className="px-4 py-3 tnum">{c.bouncedAt ? dateTime(c.bouncedAt) : '—'}</td>
                    <td className="px-4 py-3" dir="auto">
                      {c.bounceReason ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ChequeStatusChip status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle
          aside={
            canEdit ? (
              <Button size="sm" variant="secondary" asChild>
                <RouteLink to="/expenses/new" search={{ disputeId }}>
                  {tv2('disputes_addFee')}
                </RouteLink>
              </Button>
            ) : null
          }
        >
          {tv2('disputes_legalFees')}
        </SectionTitle>
        {fees.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : fees.isError || fees.data.length === 0 ? (
          <Card className="px-5 py-6 text-[15px] text-ink-soft">{tv2('disputes_noFees')}</Card>
        ) : (
          <Card className="overflow-hidden">
            {fees.data.map((e) => (
              <div
                key={e.id}
                className="row-line flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 last:border-b-0"
              >
                <RouteLink
                  to="/expenses/$expenseId"
                  params={{ expenseId: e.id }}
                  className="min-w-48 flex-1 font-medium hover:underline"
                >
                  {pick(e.reasonAr, e.reasonEn)}
                </RouteLink>
                <span className="text-[13px] text-ink-soft tnum">
                  {e.invoiceNo ?? ''} · <DateText date={e.invoiceDate} /> · {e.status}
                </span>
                <Money fils={e.totalFils} />
              </div>
            ))}
          </Card>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <SectionTitle>{t('dispute_updates')}</SectionTitle>
          {canEdit ? (
            <Card className="mb-3 flex flex-col gap-3 p-4">
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
                rows={2}
                placeholder={t('dispute_addUpdate')}
                aria-label={t('dispute_addUpdate')}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Checkbox
                  label={t('dispute_visibleToOwner')}
                  checked={visible}
                  onChange={(e) => {
                    setVisible(e.target.checked);
                  }}
                />
                <Button
                  size="sm"
                  disabled={note.trim().length === 0}
                  loading={addUpdate.isPending}
                  onClick={() => {
                    void addUpdate
                      .mutateAsync({ note: note.trim(), visibleToOwner: visible })
                      .then(() => {
                        setNote('');
                        setNotice(t('dispute_updateAdded'));
                      });
                  }}
                >
                  {t('dispute_addUpdate')}
                </Button>
              </div>
            </Card>
          ) : null}
          {!d ? (
            <Skeleton className="h-40 w-full" />
          ) : d.updates.length === 0 ? (
            <Card className="px-5 py-6 text-[15px] text-ink-soft">{t('empty_generic')}</Card>
          ) : (
            <Card className="overflow-hidden">
              {d.updates.map((u) => (
                <div key={u.id} className="row-line px-4 py-3 last:border-b-0">
                  <p className="text-[15px]" dir="auto">
                    {u.note}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-ink-soft tnum">
                    <span className={u.visibleToOwner ? 'text-status-cleared' : 'text-ink-faint'}>
                      {u.visibleToOwner ? t('dispute_visible') : t('dispute_internal')}
                    </span>
                    {u.actorName ? <span>{u.actorName}</span> : null}
                    <span>{dateTime(u.at)}</span>
                  </p>
                </div>
              ))}
            </Card>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle
              aside={
                canEdit ? (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void upload.mutateAsync({
                            entityType: 'dispute',
                            entityId: disputeId,
                            file: f,
                          });
                        e.target.value = '';
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={upload.isPending}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Paperclip className="size-4" aria-hidden /> {t('dispute_upload')}
                    </Button>
                  </>
                ) : null
              }
            >
              {t('dispute_attachments')}
            </SectionTitle>
            {!d ? (
              <Skeleton className="h-24 w-full" />
            ) : d.attachments.length === 0 ? (
              <Card className="px-5 py-6 text-[15px] text-ink-soft">
                {t('dispute_noAttachments')}
              </Card>
            ) : (
              <Card className="overflow-hidden">
                {d.attachments.map((a) => (
                  <div
                    key={a.id}
                    className="row-line flex items-center gap-3 px-4 py-2 last:border-b-0"
                  >
                    <button
                      type="button"
                      className="flex-1 truncate text-start text-[15px] hover:underline"
                      onClick={() => void openAttachment(a.id)}
                    >
                      {a.fileName || a.mime}
                    </button>
                    <span className="text-[13px] text-ink-soft tnum">
                      {Math.round(a.sizeBytes / 1024)} KB
                    </span>
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('cancel')}
                        onClick={() => {
                          del.mutate(a.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </Card>
            )}
            {upload.isError ? (
              <p className="mt-2 text-[13px] text-danger">{t('error_generic')}</p>
            ) : null}
          </section>

          <section>
            <SectionTitle>{t('dispute_internalNotes')}</SectionTitle>
            {!d ? (
              <Skeleton className="h-24 w-full" />
            ) : canEdit ? (
              <NotesEditor
                value={d.notes}
                onSave={(notes) => {
                  update.mutate({ notes });
                }}
              />
            ) : (
              <Card className="px-5 py-4 text-[15px] whitespace-pre-wrap">
                <div dir="auto">{d.notes || '—'}</div>
              </Card>
            )}
          </section>
        </div>
      </div>
      {d && linking ? (
        <LinkChequesDialog
          dispute={d}
          onClose={() => {
            setLinking(false);
          }}
          onSaved={() => {
            setLinking(false);
            setNotice(tv2('disputes_chequesSaved'));
          }}
        />
      ) : null}
    </Page>
  );
}

function LinkChequesDialog({
  dispute,
  onClose,
  onSaved,
}: {
  dispute: DisputeDetailV2;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useV2();
  const cheques = useUnitCheques(dispute.unitId);
  const save = useSetDisputeCheques(dispute.id);
  const [ids, setIds] = useState<string[]>(dispute.cheques.map((c) => c.id));
  const required = dispute.type === 'bounced_cheque';
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('disputes_linkCheques')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={required && ids.length === 0}
            loading={save.isPending}
            onClick={() => void save.mutateAsync(ids).then(onSaved)}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <ChequePicker
        cheques={cheques.data ?? []}
        loading={cheques.isPending}
        value={ids}
        onChange={setIds}
        required={required}
      />
      {required && ids.length === 0 ? (
        <p className="mt-2 text-[13px] text-danger">{t('disputes_needCheque')}</p>
      ) : null}
      {save.isError ? <p className="mt-2 text-[13px] text-danger">{t('error_generic')}</p> : null}
    </Dialog>
  );
}

function NotesEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  return (
    <Card className="flex flex-col gap-2 p-3">
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        rows={4}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={text === value}
          onClick={() => {
            onSave(text);
          }}
        >
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

export { Field };
