import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { createOwnerSchema, type CreateOwnerInput } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { prefetchOwner, useCreateOwner, useOwners } from '@/lib/queries';
import type { MessageKey } from '@/lib/messages';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function OwnersPage() {
  const { t, pick } = useI18n();
  const auth = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const q = useOwners({ search: search || undefined, status: status || undefined });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader
        title={t('owners_title')}
        actions={
          auth.hasRole('editor') ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('owners_new')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t('owners_search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          className="max-w-sm"
          aria-label={t('search')}
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
          className="w-44"
          aria-label={t('status')}
        >
          <option value="">{t('all')}</option>
          <option value="invited">{t('owner_status_invited')}</option>
          <option value="active">{t('owner_status_active')}</option>
          <option value="disabled">{t('owner_status_disabled')}</option>
        </Select>
      </div>

      {q.isPending ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={search ? t('owners_empty_search') : t('owners_empty')}
          action={
            !search && auth.hasRole('editor') ? (
              <Button
                onClick={() => {
                  setCreating(true);
                }}
              >
                {t('owners_new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead>
              <tr className="row-line text-start text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('owner')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('owner_phone')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('owner_units')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  className="row-line hover:bg-sunken last:border-b-0"
                  onMouseEnter={() => {
                    prefetchOwner(qc, o.id);
                  }}
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/owners/$ownerId"
                      params={{ ownerId: o.id }}
                      className="font-medium hover:underline"
                    >
                      {pick(o.nameAr, o.nameEn)}
                    </Link>
                    <span className="block text-[13px] text-ink-soft">
                      {pick(o.nameEn, o.nameAr)}
                    </span>
                  </td>
                  <td className="px-4 py-3 tnum" dir="ltr">
                    {o.phoneE164}
                  </td>
                  <td className="px-4 py-3 tnum">{o.unitCount}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {t(`owner_status_${o.status}` as MessageKey)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.hasNextPage ? (
            <div className="border-t border-line p-3">
              <Button
                variant="secondary"
                size="sm"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      <OwnerDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          setNotice(t('owner_created'));
        }}
      />
    </Page>
  );
}

export function OwnerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const create = useCreateOwner();
  const form = useForm<z.input<typeof createOwnerSchema>, unknown, CreateOwnerInput>({
    resolver: zodResolver(createOwnerSchema),
    defaultValues: { nameAr: '', nameEn: '', phoneE164: '+971', email: null, preferredLang: 'ar' },
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await create.mutateAsync(values);
      form.reset();
      onCreated();
    } catch (e) {
      setServerError(
        e instanceof ApiRequestError && e.status === 409
          ? t('owner_phone_exists')
          : t('error_generic'),
      );
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('owners_new')}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" form="owner-form" loading={create.isPending}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        id="owner-form"
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field label={t('owner_nameAr')} required error={form.formState.errors.nameAr?.message}>
          <Input {...form.register('nameAr')} invalid={!!form.formState.errors.nameAr} dir="rtl" />
        </Field>
        <Field label={t('owner_nameEn')} required error={form.formState.errors.nameEn?.message}>
          <Input {...form.register('nameEn')} invalid={!!form.formState.errors.nameEn} dir="ltr" />
        </Field>
        <Field
          label={t('owner_phone')}
          required
          hint={t('owner_phone_hint')}
          error={form.formState.errors.phoneE164?.message}
        >
          <Input
            {...form.register('phoneE164')}
            invalid={!!form.formState.errors.phoneE164}
            numeric
            inputMode="tel"
          />
        </Field>
        <Field label={t('owner_email')} error={form.formState.errors.email?.message}>
          <Input
            type="email"
            dir="ltr"
            {...form.register('email', {
              setValueAs: (v: string) => (v.trim() === '' ? null : v.trim()),
            })}
          />
        </Field>
        <Field label={t('owner_lang')} required>
          <Select {...form.register('preferredLang')}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </Field>
        {serverError ? (
          <p role="alert" className="text-[13px] text-danger">
            {serverError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
