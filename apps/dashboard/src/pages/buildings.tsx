import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { createBuildingSchema, type CreateBuildingInput } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { prefetchBuilding, useBuildings, useCreateBuilding } from '@/lib/queries';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  SkeletonRows,
  Textarea,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function BuildingsPage() {
  const { t, pick } = useI18n();
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useBuildings();
  const [creating, setCreating] = useState(false);

  return (
    <Page>
      <PageHeader
        title={t('buildings_title')}
        actions={
          auth.hasRole('editor') ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('buildings_new')}
            </Button>
          ) : null
        }
      />
      {q.isPending ? (
        <SkeletonRows rows={4} cols={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          title={t('buildings_empty')}
          action={
            auth.hasRole('editor') ? (
              <Button
                onClick={() => {
                  setCreating(true);
                }}
              >
                {t('buildings_new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((b) => (
            <Link
              key={b.id}
              to="/buildings/$buildingId"
              params={{ buildingId: b.id }}
              onMouseEnter={() => {
                prefetchBuilding(qc, b.id);
              }}
              className="card flex flex-col gap-1 px-5 py-4 hover:bg-sunken"
            >
              <span className="text-[17px] font-semibold">{pick(b.nameAr, b.nameEn)}</span>
              <span className="text-[13px] text-ink-soft">{pick(b.nameEn, b.nameAr)}</span>
              <span className="text-[13px] text-ink-soft">{b.area}</span>
              <span className="mt-2 flex items-baseline gap-3 tnum">
                <span className="text-[15px]">{t('building_units', { n: b.unitCount })}</span>
                <span className="text-[13px] text-ink-soft">
                  {t('building_occupied', { occupied: b.occupiedCount })}
                </span>
              </span>
              <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
                <span
                  className="block h-full bg-primary"
                  style={{
                    width: `${b.unitCount ? Math.round((b.occupiedCount / b.unitCount) * 100) : 0}%`,
                  }}
                />
              </span>
            </Link>
          ))}
        </div>
      )}
      <BuildingDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function BuildingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const create = useCreateBuilding();
  const form = useForm<z.input<typeof createBuildingSchema>, unknown, CreateBuildingInput>({
    resolver: zodResolver(createBuildingSchema),
    defaultValues: { nameAr: '', nameEn: '', area: '', address: '', notes: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    await create.mutateAsync(v);
    form.reset();
    onOpenChange(false);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('buildings_new')}
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
          <Button type="submit" form="building-form" loading={create.isPending}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        id="building-form"
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field label={t('building_nameAr')} required error={form.formState.errors.nameAr?.message}>
          <Input {...form.register('nameAr')} dir="rtl" invalid={!!form.formState.errors.nameAr} />
        </Field>
        <Field label={t('building_nameEn')} required error={form.formState.errors.nameEn?.message}>
          <Input {...form.register('nameEn')} dir="ltr" invalid={!!form.formState.errors.nameEn} />
        </Field>
        <Field label={t('building_area')} required error={form.formState.errors.area?.message}>
          <Input
            {...form.register('area')}
            placeholder="Business Bay, Dubai"
            invalid={!!form.formState.errors.area}
          />
        </Field>
        <Field label={t('building_address')}>
          <Textarea {...form.register('address')} rows={2} />
        </Field>
        {create.isError ? <p className="text-[13px] text-danger">{t('error_generic')}</p> : null}
      </form>
    </Dialog>
  );
}
