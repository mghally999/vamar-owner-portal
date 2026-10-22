import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { sharePct } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useChangeOwnerPhone, useOwner, useSetOwnerStatus } from '@/lib/queries';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Skeleton,
  Textarea,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function OwnerDetailPage() {
  const ownerId = useParams({ strict: false }).ownerId ?? '';
  const { t, pick, dateTime, date } = useI18n();
  const auth = useAuth();
  const q = useOwner(ownerId);
  const setStatus = useSetOwnerStatus(ownerId);
  const changePhone = useChangeOwnerPhone(ownerId);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('+971');
  const [reason, setReason] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const o = q.data;

  return (
    <Page>
      <PageHeader
        title={o ? pick(o.nameAr, o.nameEn) : ''}
        subtitle={
          o ? (
            <span className="flex flex-wrap gap-x-4">
              <span>{pick(o.nameEn, o.nameAr)}</span>
              <span className="tnum" dir="ltr">
                {o.phoneE164}
              </span>
              {o.email ? <span dir="ltr">{o.email}</span> : null}
              <span>{t(`owner_status_${o.status}` as MessageKey)}</span>
              <span>{o.preferredLang === 'ar' ? 'العربية' : 'English'}</span>
            </span>
          ) : (
            <Skeleton className="h-5 w-80" />
          )
        }
        actions={
          o && auth.hasRole('editor') ? (
            <span className="flex gap-2">
              {auth.hasRole('admin') ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNewPhone(o.phoneE164);
                    setReason('');
                    setPhoneError(null);
                    setPhoneOpen(true);
                  }}
                >
                  {t('owner_changePhone')}
                </Button>
              ) : null}
              {o.status === 'disabled' ? (
                <Button
                  variant="secondary"
                  loading={setStatus.isPending}
                  onClick={() => {
                    setStatus.mutate('active');
                  }}
                >
                  {t('owner_enable')}
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={() => {
                    setConfirmDisable(true);
                  }}
                >
                  {t('owner_disable')}
                </Button>
              )}
            </span>
          ) : null
        }
      />

      <section>
        <SectionTitle>{t('owner_units')}</SectionTitle>
        {!o ? (
          <Skeleton className="h-32 w-full" />
        ) : o.holdings.length === 0 ? (
          <EmptyState title={t('owner_holdings_empty')} />
        ) : (
          <Card className="overflow-hidden">
            {o.holdings.map((h) => (
              <div
                key={h.unitId}
                className="row-line flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 last:border-b-0"
              >
                <Link
                  to="/buildings/$buildingId"
                  params={{ buildingId: h.buildingId }}
                  className="min-w-56 flex-1 font-medium hover:underline"
                >
                  {pick(h.buildingNameAr, h.buildingNameEn)} · {h.unitNo}
                </Link>
                <span className="text-ink-soft">
                  {t(`unit_type_${h.type}` as MessageKey) === `unit_type_${h.type}`
                    ? h.type
                    : t(`unit_type_${h.type}` as MessageKey)}
                </span>
                <span className="tnum">
                  {t('owner_share')} {sharePct(h.shareBp)}%
                </span>
                <span className="tnum text-ink-soft">
                  {t('from')} {date(h.fromDate)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>{t('owner_devices')}</SectionTitle>
        {!o ? (
          <Skeleton className="h-20 w-full" />
        ) : o.devices.length === 0 ? (
          <EmptyState title={t('owner_devices_empty')} />
        ) : (
          <Card className="overflow-hidden">
            {o.devices.map((d) => (
              <div
                key={d.id}
                className="row-line flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 last:border-b-0"
              >
                <span className="min-w-48 flex-1 font-medium">{d.model || d.platform}</span>
                <span className="text-ink-soft">{d.platform === 'ios' ? 'iOS' : 'Android'}</span>
                <span className="tnum text-ink-soft">
                  {t('owner_lastSeen')} {dateTime(d.lastSeen)}
                </span>
                <span className="text-[13px] text-ink-soft">
                  {d.revokedAt
                    ? t('signOut')
                    : d.hasPushToken
                      ? t('owner_pushEnabled')
                      : t('owner_pushDisabled')}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <Dialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={t('owner_disable')}
        description={t('owner_disable_confirm')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmDisable(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              loading={setStatus.isPending}
              onClick={() => {
                void setStatus.mutateAsync('disabled').then(() => {
                  setConfirmDisable(false);
                });
              }}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <span />
      </Dialog>

      <Dialog
        open={phoneOpen}
        onOpenChange={setPhoneOpen}
        title={t('owner_changePhone')}
        description={t('owner_changePhone_hint')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPhoneOpen(false);
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              loading={changePhone.isPending}
              disabled={reason.trim().length < 3 || !/^\+9715\d{8}$/.test(newPhone.trim())}
              onClick={() => {
                setPhoneError(null);
                changePhone
                  .mutateAsync({ phoneE164: newPhone.trim(), reason: reason.trim() })
                  .then(() => {
                    setPhoneOpen(false);
                  })
                  .catch((err: unknown) => {
                    setPhoneError(
                      err instanceof ApiRequestError && err.status === 409
                        ? t('owner_phone_exists')
                        : t('error_generic'),
                    );
                  });
              }}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field
            label={t('owner_phone')}
            required
            hint={t('owner_phone_hint')}
            error={phoneError ?? undefined}
          >
            <Input
              dir="ltr"
              inputMode="tel"
              value={newPhone}
              onChange={(e) => {
                setNewPhone(e.target.value);
              }}
            />
          </Field>
          <Field label={t('owner_changePhone_reason')} required>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </Field>
        </div>
      </Dialog>
    </Page>
  );
}
