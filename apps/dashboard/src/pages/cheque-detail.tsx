import { Link, useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { getAccessToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useCheque, useUploadChequeImage } from '@/lib/queries';
import { StatusDialog } from '@/ui/status-dialog';
import {
  Button,
  Card,
  ChequeStatusChip,
  DateText,
  ErrorState,
  Money,
  PageHeader,
  SectionTitle,
  Skeleton,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function ChequeDetailPage() {
  const chequeId = useParams({ strict: false }).chequeId ?? '';
  const { t, pick, dateTime } = useI18n();
  const auth = useAuth();
  const q = useCheque(chequeId);
  const upload = useUploadChequeImage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const c = q.data;

  async function loadImage() {
    const res = await fetch(`/api/staff/cheques/${chequeId}/image`, {
      headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
    });
    if (res.ok) setImageUrl(URL.createObjectURL(await res.blob()));
  }

  return (
    <Page>
      <PageHeader
        title={c ? `${t('cheque_no')} ${c.chequeNo ?? '—'}` : ''}
        subtitle={
          c ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <ChequeStatusChip status={c.status} />
              <Link
                to="/contracts/$contractId"
                params={{ contractId: c.contractId }}
                className="hover:underline"
              >
                {pick(c.buildingNameAr, c.buildingNameEn)} · {c.unitNo}
              </Link>
              <span>{c.tenantName}</span>
              <span>{c.bankName}</span>
            </span>
          ) : (
            <Skeleton className="h-5 w-80" />
          )
        }
        actions={
          c && auth.hasRole('editor') ? (
            <Button
              onClick={() => {
                setChanging(true);
              }}
            >
              {t('cheque_changeStatus')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}

      <Card className="grid gap-4 px-6 py-5 sm:grid-cols-3">
        <div>
          <p className="text-[13px] text-ink-soft">{t('amount')}</p>
          {c ? (
            <p className="text-hero font-semibold text-primary">
              <Money fils={c.amountFils} />
            </p>
          ) : (
            <Skeleton className="mt-2 h-9 w-40" />
          )}
        </div>
        <div>
          <p className="text-[13px] text-ink-soft">{t('dueDate')}</p>
          {c ? (
            <p className="text-heading font-semibold">
              <DateText date={c.dueDate} />
            </p>
          ) : (
            <Skeleton className="mt-2 h-7 w-32" />
          )}
        </div>
        <div>
          <p className="text-[13px] text-ink-soft">{t('status')}</p>
          {c ? (
            <p className="text-[15px]">
              {t(`cheque_status_${c.status}` as MessageKey)}
              {c.bounceReason ? (
                <span className="block text-[13px] text-status-bounced">{c.bounceReason}</span>
              ) : null}
              {c.replacedBy ? (
                <Link
                  to="/cheques/$chequeId"
                  params={{ chequeId: c.replacedBy.id }}
                  className="block text-[13px] text-ink-soft hover:underline"
                >
                  {t('cheque_replacedBy', { no: c.replacedBy.chequeNo ?? '' })}
                </Link>
              ) : null}
              {c.replacesChequeId ? (
                <Link
                  to="/cheques/$chequeId"
                  params={{ chequeId: c.replacesChequeId }}
                  className="block text-[13px] text-ink-soft hover:underline"
                >
                  {t('cheque_replaces', { no: '' })}
                </Link>
              ) : null}
            </p>
          ) : (
            <Skeleton className="mt-2 h-5 w-24" />
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>{t('cheque_timeline')}</SectionTitle>
          {!c ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Card className="px-5 py-2">
              <ol className="flex flex-col">
                {c.timeline.map((e, i) => (
                  <li key={e.id} className="relative flex gap-4 py-3 ps-6">
                    <span
                      className="absolute start-0 top-5 size-2.5 rounded-full bg-primary"
                      aria-hidden
                    />
                    {i < c.timeline.length - 1 ? (
                      <span
                        className="absolute start-[4px] top-8 bottom-0 w-px bg-line"
                        aria-hidden
                      />
                    ) : null}
                    <div className="flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px]">
                        <ChequeStatusChip status={e.toStatus} />
                        {e.actorName ? <span className="text-ink-soft">{e.actorName}</span> : null}
                      </p>
                      {e.note ? <p className="mt-1 text-[13px] text-ink-soft">{e.note}</p> : null}
                      <p className="mt-1 text-[13px] text-ink-faint tnum">{dateTime(e.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </section>

        <section>
          <SectionTitle
            aside={
              auth.hasRole('editor') ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void upload.mutateAsync({ id: chequeId, file: f }).then(() => {
                          setNotice(t('cheque_uploadImage'));
                          setImageUrl(null);
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
                    {t('cheque_uploadImage')}
                  </Button>
                </>
              ) : null
            }
          >
            {t('cheque_image')}
          </SectionTitle>
          {!c ? (
            <Skeleton className="h-40 w-full" />
          ) : !c.hasImage ? (
            <Card className="px-5 py-8 text-[15px] text-ink-soft">{t('cheque_noImage')}</Card>
          ) : imageUrl ? (
            <Card className="overflow-hidden p-2">
              <img
                src={imageUrl}
                alt={t('cheque_image')}
                className="max-h-[480px] w-full rounded-sm object-contain"
              />
            </Card>
          ) : (
            <Card className="flex items-center justify-center px-5 py-8">
              <Button variant="secondary" onClick={() => void loadImage()}>
                {t('cheque_image')}
              </Button>
            </Card>
          )}
          {upload.isError ? (
            <p className="mt-2 text-[13px] text-danger">{t('error_generic')}</p>
          ) : null}
        </section>
      </div>

      {changing && c ? (
        <StatusDialog
          cheque={c}
          onClose={() => {
            setChanging(false);
          }}
          onDone={() => {
            setChanging(false);
            setNotice(t('cheque_statusChanged'));
          }}
        />
      ) : null}
    </Page>
  );
}
