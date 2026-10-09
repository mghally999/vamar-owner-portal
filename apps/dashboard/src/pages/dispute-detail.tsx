import { Link, useParams } from '@tanstack/react-router';
import { Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { DISPUTE_STATUSES, DISPUTE_STATUS_LABEL, DISPUTE_TYPE_LABEL } from '@vamar/shared';
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
  DateText,
  DisputeStatusChip,
  ErrorState,
  Field,
  Input,
  Money,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
  Textarea,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function DisputeDetailPage() {
  const disputeId = useParams({ strict: false }).disputeId ?? '';
  const { t, pick, lang, dateTime } = useI18n();
  const auth = useAuth();
  const q = useDispute(disputeId);
  const update = useUpdateDispute(disputeId);
  const addUpdate = useAddDisputeUpdate(disputeId);
  const upload = useUploadAttachment();
  const del = useDeleteAttachment(disputeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  const canEdit = auth.hasRole('editor');

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
              <Input
                type="date"
                value={hearing ?? d.nextHearingDate ?? ''}
                onChange={(e) => {
                  setHearing(e.target.value);
                }}
                onBlur={() => {
                  if (hearing !== null && hearing !== (d.nextHearingDate ?? ''))
                    update.mutate({ nextHearingDate: hearing === '' ? null : hearing });
                }}
                numeric
                className="h-10"
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
                  <p className="text-[15px]" dir="auto">{u.note}</p>
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
              <Card className="px-5 py-4 text-[15px] whitespace-pre-wrap" dir="auto">{d.notes || '—'}</Card>
            )}
          </section>
        </div>
      </div>
    </Page>
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
