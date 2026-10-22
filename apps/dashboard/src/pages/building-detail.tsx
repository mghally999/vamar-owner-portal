import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { sharePct, todayInDubai, UNIT_TYPES, validateShares } from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useBuilding, useCreateUnit, useOwners, useSetUnitOwners } from '@/lib/queries';
import type { BuildingUnit } from '@/lib/types';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  PageHeader,
  SectionTitle,
  Select,
  Skeleton,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

const UNIT_TYPE_LABEL: Record<(typeof UNIT_TYPES)[number], { ar: string; en: string }> = {
  apartment: { ar: 'شقة', en: 'Apartment' },
  villa: { ar: 'فيلا', en: 'Villa' },
  shop: { ar: 'محل', en: 'Shop' },
  office: { ar: 'مكتب', en: 'Office' },
  warehouse: { ar: 'مستودع', en: 'Warehouse' },
  other: { ar: 'أخرى', en: 'Other' },
};

export function BuildingDetailPage() {
  const buildingId = useParams({ strict: false }).buildingId ?? '';
  const { t, pick } = useI18n();
  const auth = useAuth();
  const q = useBuilding(buildingId);
  const [addingUnit, setAddingUnit] = useState(false);
  const [sharesFor, setSharesFor] = useState<BuildingUnit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const b = q.data;

  return (
    <Page>
      <PageHeader
        title={b ? pick(b.nameAr, b.nameEn) : ''}
        subtitle={
          b ? (
            `${pick(b.nameEn, b.nameAr)} · ${b.area}${b.address ? ` · ${b.address}` : ''}`
          ) : (
            <Skeleton className="h-5 w-72" />
          )
        }
        actions={
          auth.hasRole('editor') ? (
            <Button
              onClick={() => {
                setAddingUnit(true);
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('units_new')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      <section>
        <SectionTitle>{t('units_title')}</SectionTitle>
        {!b ? (
          <Skeleton className="h-48 w-full" />
        ) : b.units.length === 0 ? (
          <EmptyState
            title={t('units_empty')}
            action={
              auth.hasRole('editor') ? (
                <Button
                  onClick={() => {
                    setAddingUnit(true);
                  }}
                >
                  {t('units_new')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="px-4 py-2 text-start font-medium">{t('unit_no')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('unit_type')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('unit_owners')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tenant')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('contract_rent')}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {b.units.map((u) => (
                  <tr key={u.id} className="row-line last:border-b-0">
                    <td className="px-4 py-3 font-medium tnum">{u.unitNo}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {pick(UNIT_TYPE_LABEL[u.type].ar, UNIT_TYPE_LABEL[u.type].en)}
                      {u.bedrooms ? (
                        <span className="text-ink-faint"> · {u.bedrooms} BR</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {u.owners.length === 0 ? (
                        <span className="text-ink-faint">{t('unit_noOwners')}</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-3">
                          {u.owners.map((o) => (
                            <Link
                              key={o.ownerId}
                              to="/owners/$ownerId"
                              params={{ ownerId: o.ownerId }}
                              className="hover:underline"
                            >
                              {pick(o.nameAr, o.nameEn)}
                              {u.owners.length > 1 ? (
                                <span className="tnum text-ink-soft"> {sharePct(o.shareBp)}%</span>
                              ) : null}
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.contract ? (
                        <Link
                          to="/contracts/$contractId"
                          params={{ contractId: u.contract.id }}
                          className="hover:underline"
                        >
                          {u.contract.tenantName}
                          <span className="block text-[13px] text-ink-soft">
                            {t('unit_endsOn', { date: '' })}
                            <DateText date={u.contract.endDate} />
                          </span>
                        </Link>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={u.occupied ? 'text-status-cleared' : 'text-ink-soft'}>
                        {u.occupied ? t('unit_occupied') : t('unit_vacant')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {u.contract ? (
                        <Money fils={u.contract.annualRentFils} />
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-end">
                      {auth.hasRole('editor') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSharesFor(u);
                          }}
                        >
                          {t('unit_assignOwners')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <UnitDialog buildingId={buildingId} open={addingUnit} onOpenChange={setAddingUnit} />
      {sharesFor ? (
        <SharesDialog
          buildingId={buildingId}
          unit={sharesFor}
          onClose={() => {
            setSharesFor(null);
          }}
          onSaved={() => {
            setSharesFor(null);
            setNotice(t('shares_saved'));
          }}
        />
      ) : null}
    </Page>
  );
}

const unitFormSchema = z.object({
  unitNo: z.string().trim().min(1).max(30),
  type: z.enum(UNIT_TYPES),
  bedrooms: z.union([z.literal(''), z.coerce.number().int().min(0).max(20)]),
  sizeSqft: z.union([z.literal(''), z.coerce.number().int().positive()]),
});
type UnitFormInput = z.input<typeof unitFormSchema>;
type UnitForm = z.output<typeof unitFormSchema>;

function UnitDialog({
  buildingId,
  open,
  onOpenChange,
}: {
  buildingId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, pick } = useI18n();
  const create = useCreateUnit(buildingId);
  const form = useForm<UnitFormInput, unknown, UnitForm>({
    resolver: zodResolver(unitFormSchema),
    defaultValues: { unitNo: '', type: 'apartment', bedrooms: '', sizeSqft: '' },
  });
  const [err, setErr] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setErr(null);
    try {
      await create.mutateAsync({
        unitNo: v.unitNo,
        type: v.type,
        bedrooms: v.bedrooms === '' ? null : v.bedrooms,
        sizeSqft: v.sizeSqft === '' ? null : v.sizeSqft,
      });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      setErr(
        e instanceof ApiRequestError && e.status === 409 ? t('error_conflict') : t('error_generic'),
      );
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('units_new')}
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
          <Button type="submit" form="unit-form" loading={create.isPending}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        id="unit-form"
        onSubmit={(e) => void submit(e)}
        className="grid gap-4 sm:grid-cols-2"
        noValidate
      >
        <Field label={t('unit_no')} required error={form.formState.errors.unitNo?.message}>
          <Input {...form.register('unitNo')} numeric invalid={!!form.formState.errors.unitNo} />
        </Field>
        <Field label={t('unit_type')} required>
          <Select {...form.register('type')}>
            {UNIT_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {pick(UNIT_TYPE_LABEL[ty].ar, UNIT_TYPE_LABEL[ty].en)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('unit_bedrooms')} error={form.formState.errors.bedrooms?.message}>
          <Input {...form.register('bedrooms')} numeric inputMode="numeric" />
        </Field>
        <Field label={t('unit_size')} error={form.formState.errors.sizeSqft?.message}>
          <Input {...form.register('sizeSqft')} numeric inputMode="numeric" />
        </Field>
        {err ? <p className="text-[13px] text-danger sm:col-span-2">{err}</p> : null}
      </form>
    </Dialog>
  );
}

interface ShareRow {
  ownerId: string;
  percent: string;
}

function SharesDialog({
  buildingId,
  unit,
  onClose,
  onSaved,
}: {
  buildingId: string;
  unit: BuildingUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, pick } = useI18n();
  const save = useSetUnitOwners(buildingId);
  const ownersQ = useOwners({});
  const allOwners = useMemo(
    () => ownersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [ownersQ.data],
  );
  useEffect(() => {
    if (ownersQ.hasNextPage && !ownersQ.isFetchingNextPage) void ownersQ.fetchNextPage();
  }, [ownersQ]);

  const [rows, setRows] = useState<ShareRow[]>(
    unit.owners.length
      ? unit.owners.map((o) => ({ ownerId: o.ownerId, percent: String(sharePct(o.shareBp)) }))
      : [{ ownerId: '', percent: '100' }],
  );
  const [fromDate, setFromDate] = useState(todayInDubai());
  const [err, setErr] = useState<string | null>(null);

  const bpRows = rows.map((r) => ({
    ownerId: r.ownerId,
    shareBp: Math.round(Number(r.percent) * 100),
  }));
  const totalPercent =
    bpRows.reduce((a, r) => a + (Number.isFinite(r.shareBp) ? r.shareBp : 0), 0) / 100;
  const complete = bpRows.every((r) => r.ownerId && r.shareBp >= 1 && r.shareBp <= 10_000);
  const validation = complete ? validateShares(bpRows) : null;
  const valid = validation?.valid ?? false;

  async function submit() {
    setErr(null);
    try {
      await save.mutateAsync({ unitId: unit.id, fromDate, owners: bpRows });
      onSaved();
    } catch (e) {
      setErr(
        e instanceof ApiRequestError && e.code === 'shares_invalid'
          ? t('shares_invalid', { total: totalPercent })
          : t('error_generic'),
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`${t('shares_title')} · ${unit.unitNo}`}
      description={t('shares_hint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!valid} loading={save.isPending}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label={t('owner')} required>
              <Select
                value={r.ownerId}
                onChange={(e) => {
                  setRows(rows.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)));
                }}
                invalid={!r.ownerId}
              >
                <option value="">{t('shares_pickOwner')}</option>
                {allOwners.map((o) => (
                  <option
                    key={o.id}
                    value={o.id}
                    disabled={rows.some((x, j) => j !== i && x.ownerId === o.id)}
                  >
                    {pick(o.nameAr, o.nameEn)} · {o.phoneE164}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('shares_percent')} required>
              <Input
                value={r.percent}
                onChange={(e) => {
                  setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)));
                }}
                numeric
                inputMode="decimal"
                className="w-28"
              />
            </Field>
            <Button
              variant="ghost"
              size="md"
              aria-label={t('shares_remove')}
              disabled={rows.length === 1}
              onClick={() => {
                setRows(rows.filter((_, j) => j !== i));
              }}
              className="shrink-0 px-3"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setRows([...rows, { ownerId: '', percent: '' }]);
            }}
          >
            <Plus className="size-4" aria-hidden /> {t('shares_addOwner')}
          </Button>
          <p className={`tnum text-[15px] ${valid ? 'text-status-cleared' : 'text-danger'}`}>
            {t('shares_total')} {Number.isFinite(totalPercent) ? totalPercent : 0}%
          </p>
        </div>
        <Field label={t('shares_fromDate')} required>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value as typeof fromDate);
            }}
            numeric
            className="max-w-56"
          />
        </Field>
        {!valid && complete ? (
          <p className="text-[13px] text-danger">{t('shares_invalid', { total: totalPercent })}</p>
        ) : null}
        {err ? <p className="text-[13px] text-danger">{err}</p> : null}
      </div>
    </Dialog>
  );
}
