/**
 * The expense form (new draft, or an existing draft being edited): scope, building and unit,
 * category, vendor (with an inline "new vendor" dialog), reason in both languages, invoice number
 * and date, the covered period, amount and VAT (5 % when the vendor has a TRN, editable to 0),
 * payment, the allocation method with a live preview of each owner's share, and the owner
 * visibility switch. Warnings (duplicate invoice, outlier) come from the API as you type.
 */
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ALLOCATION_METHODS,
  PAYMENT_METHODS,
  formatNumber,
  parseAmountInput,
  todayInDubai,
  vatFor,
  type AllocationMethod,
  type PaymentMethod,
  type PlainDate,
} from '@vamar/shared';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useBuilding, useBuildings } from '@/lib/queries';
import {
  useCategories,
  useCreateVendor,
  useExpenseWarnings,
  useHolidaySet,
  usePreviewAllocation,
  useVendors,
} from '@/lib/queries-v2';
import type { ExpenseDetail, ExpenseWarnings } from '@/lib/types-v2';
import { DatePicker } from './date-picker';
import { Dialog } from './dialog';
import { Button, Card, Checkbox, Field, Input, Money, Select, cx } from './primitives';
import { ResponsiveTable } from './responsive-table';

export interface ExpenseFormValues {
  scope: 'building' | 'unit';
  buildingId: string;
  unitId: string | null;
  categoryId: string;
  vendorId: string | null;
  reasonAr: string;
  reasonEn: string;
  invoiceNo: string | null;
  invoiceDate: PlainDate;
  coversFrom: PlainDate | null;
  coversTo: PlainDate | null;
  amountFils: number;
  vatFils: number;
  paidOn: PlainDate | null;
  paymentMethod: PaymentMethod | null;
  allocationMethod?: AllocationMethod;
  visibleToOwner: boolean;
  workOrderId?: string | null;
}

const aedText = (fils: number | null | undefined) =>
  fils === null || fils === undefined ? '' : formatNumber(fils, 'en').replace(/,/g, '');

export function ExpenseForm({
  initial,
  onSubmit,
  submitLabel,
  busy,
  error,
  extraActions,
  workOrderId,
}: {
  initial?: ExpenseDetail | undefined;
  onSubmit: (values: ExpenseFormValues) => void;
  submitLabel: string;
  busy?: boolean | undefined;
  error?: string | null | undefined;
  extraActions?: React.ReactNode;
  /** When the form is opened from a work order, the invoice is linked to it. */
  workOrderId?: string | undefined;
}) {
  const { t, pick, lang, money, date } = useI18n();
  const buildings = useBuildings();
  const categories = useCategories();
  const vendors = useVendors();
  const holidays = useHolidaySet();
  const preview = usePreviewAllocation();
  const warn = useExpenseWarnings();

  const [scope, setScope] = useState<'building' | 'unit'>(initial?.scope ?? 'building');
  const [buildingId, setBuildingId] = useState(initial?.buildingId ?? '');
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? '');
  const [reasonAr, setReasonAr] = useState(initial?.reasonAr ?? '');
  const [reasonEn, setReasonEn] = useState(initial?.reasonEn ?? '');
  const [invoiceNo, setInvoiceNo] = useState(initial?.invoiceNo ?? '');
  const [invoiceDate, setInvoiceDate] = useState<PlainDate | null>(
    (initial?.invoiceDate as PlainDate | undefined) ?? todayInDubai(),
  );
  const [coversFrom, setCoversFrom] = useState<PlainDate | null>(
    (initial?.coversFrom as PlainDate | null | undefined) ?? null,
  );
  const [coversTo, setCoversTo] = useState<PlainDate | null>(
    (initial?.coversTo as PlainDate | null | undefined) ?? null,
  );
  const [amountText, setAmountText] = useState(aedText(initial?.amountFils));
  const [vatText, setVatText] = useState(aedText(initial?.vatFils));
  const [vatTouched, setVatTouched] = useState(initial !== undefined);
  const [paidOn, setPaidOn] = useState<PlainDate | null>(
    (initial?.paidOn as PlainDate | null | undefined) ?? null,
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(
    initial?.paymentMethod ?? '',
  );
  const [method, setMethod] = useState<AllocationMethod | ''>(initial?.allocationMethod ?? '');
  const [visibleToOwner, setVisibleToOwner] = useState(initial?.visibleToOwner ?? true);
  const [newVendor, setNewVendor] = useState(false);
  const [warnings, setWarnings] = useState<ExpenseWarnings | null>(null);

  const building = useBuilding(buildingId);
  const units = useMemo(
    () => (building.data?.units ?? []).filter((u) => u.active),
    [building.data],
  );
  const vendor = vendors.data?.find((v) => v.id === vendorId);
  const amountFils = parseAmountInput(amountText);
  const vatFils = vatText.trim() === '' ? 0 : parseAmountInput(vatText);
  const totalFils = amountFils !== null && vatFils !== null ? amountFils + vatFils : null;

  // VAT follows the vendor's TRN until staff type their own value.
  useEffect(() => {
    if (vatTouched) return;
    if (amountFils === null) return;
    setVatText(vendor?.trn ? aedText(vatFor(amountFils)) : '0');
  }, [vendor, amountFils, vatTouched]);

  // Live preview of the owners' shares.
  const previewKey = useDebounced(
    JSON.stringify({ scope, buildingId, unitId, invoiceDate, totalFils, method }),
    400,
  );
  useEffect(() => {
    const k = JSON.parse(previewKey) as {
      scope: 'building' | 'unit';
      buildingId: string;
      unitId: string;
      invoiceDate: PlainDate | null;
      totalFils: number | null;
      method: AllocationMethod | '';
    };
    if (!k.buildingId || !k.invoiceDate || !k.totalFils || k.totalFils <= 0) return;
    if (k.scope === 'unit' && !k.unitId) return;
    preview.mutate({
      scope: k.scope,
      buildingId: k.buildingId,
      unitId: k.scope === 'unit' ? k.unitId : null,
      invoiceDate: k.invoiceDate,
      totalFils: k.totalFils,
      allocationMethod: k.scope === 'unit' ? 'single_unit' : k.method || undefined,
    });
  }, [previewKey]);

  // Warnings: duplicate invoice number and outlier amount.
  const warnKey = useDebounced(JSON.stringify({ vendorId, invoiceNo, categoryId, totalFils }), 500);
  useEffect(() => {
    const k = JSON.parse(warnKey) as {
      vendorId: string;
      invoiceNo: string;
      categoryId: string;
      totalFils: number | null;
    };
    if (!k.categoryId || !k.totalFils || k.totalFils <= 0) {
      setWarnings(null);
      return;
    }
    warn
      .mutateAsync({
        vendorId: k.vendorId || null,
        invoiceNo: k.invoiceNo.trim() || null,
        categoryId: k.categoryId,
        totalFils: k.totalFils,
        excludeId: initial?.id,
      })
      .then(setWarnings)
      .catch(() => {
        setWarnings(null);
      });
  }, [warnKey]);

  const canSubmit =
    buildingId !== '' &&
    (scope === 'building' || unitId !== '') &&
    categoryId !== '' &&
    reasonAr.trim() !== '' &&
    reasonEn.trim() !== '' &&
    invoiceDate !== null &&
    amountFils !== null &&
    amountFils > 0 &&
    vatFils !== null &&
    (coversFrom === null || coversTo === null || coversTo >= coversFrom);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      scope,
      buildingId,
      unitId: scope === 'unit' ? unitId : null,
      categoryId,
      vendorId: vendorId || null,
      reasonAr: reasonAr.trim(),
      reasonEn: reasonEn.trim(),
      invoiceNo: invoiceNo.trim() || null,
      invoiceDate,
      coversFrom,
      coversTo,
      amountFils,
      vatFils,
      paidOn,
      paymentMethod: paymentMethod || null,
      ...(scope === 'unit'
        ? { allocationMethod: 'single_unit' as const }
        : method
          ? { allocationMethod: method }
          : {}),
      visibleToOwner,
      ...(workOrderId ? { workOrderId } : {}),
    });
  };

  const categoryOptions = (kind: 'fixed' | 'variable') =>
    (categories.data ?? []).filter((c) => c.kind === kind);

  return (
    <div className="flex flex-col gap-6">
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('expense_scope')} required>
          <div className="flex gap-2" role="radiogroup" aria-label={t('expense_scope')}>
            {(['building', 'unit'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                // Named by its own text: the field's wrapping label would otherwise name the first choice.
                aria-label={t(`expense_scope_${s}`)}
                onClick={() => {
                  setScope(s);
                  if (s === 'building') setUnitId('');
                }}
                className={cx(
                  'h-11 flex-1 rounded-md border px-3 text-[15px] font-medium',
                  scope === s
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-line-strong bg-elevated hover:bg-sunken',
                )}
              >
                {t(`expense_scope_${s}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('building')} required>
          <Select
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value);
              setUnitId('');
            }}
          >
            <option value="">—</option>
            {buildings.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {pick(b.nameAr, b.nameEn)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('unit')}
          required={scope === 'unit'}
          hint={scope === 'building' ? t('expense_unitHint') : undefined}
        >
          <Select
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
            }}
            disabled={scope !== 'unit' || !buildingId}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNo}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('expense_category')} required>
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
            }}
          >
            <option value="">{t('expense_category_pick')}</option>
            <optgroup label={t('expense_kind_fixed')}>
              {categoryOptions('fixed').map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.nameAr, c.nameEn)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('expense_kind_variable')}>
              {categoryOptions('variable').map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.nameAr, c.nameEn)}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label={t('expense_vendor')}>
          <div className="flex gap-2">
            <Select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setVatTouched(false);
              }}
            >
              <option value="">{t('expense_vendor_none')}</option>
              {vendors.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.trn ? ' · TRN' : ''}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => {
                setNewVendor(true);
              }}
              aria-label={t('vendor_new')}
              className="shrink-0 px-3"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </Field>
        <Field label={t('expense_invoiceNo')}>
          <Input
            value={invoiceNo}
            onChange={(e) => {
              setInvoiceNo(e.target.value);
            }}
            numeric
          />
        </Field>
        <Field label={t('expense_reasonAr')} required>
          <Input
            value={reasonAr}
            onChange={(e) => {
              setReasonAr(e.target.value);
            }}
            dir="rtl"
          />
        </Field>
        <Field label={t('expense_reasonEn')} required>
          <Input
            value={reasonEn}
            onChange={(e) => {
              setReasonEn(e.target.value);
            }}
            dir="ltr"
          />
        </Field>
        <Field label={t('expense_invoiceDate')} required>
          <DatePicker
            value={invoiceDate}
            onChange={setInvoiceDate}
            holidays={holidays}
            aria-label={t('expense_invoiceDate')}
          />
        </Field>
        <Field label={t('expense_coversFrom')}>
          <DatePicker
            value={coversFrom}
            onChange={setCoversFrom}
            clearable
            aria-label={t('expense_coversFrom')}
          />
        </Field>
        <Field
          label={t('expense_coversTo')}
          error={coversFrom && coversTo && coversTo < coversFrom ? t('error_generic') : undefined}
        >
          <DatePicker
            value={coversTo}
            onChange={setCoversTo}
            clearable
            min={coversFrom ?? undefined}
            aria-label={t('expense_coversTo')}
          />
        </Field>
        <Field label={t('expense_amount')} required>
          <Input
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
            }}
            numeric
            inputMode="decimal"
            placeholder="1,500"
            invalid={amountText.trim() !== '' && (amountFils === null || amountFils === 0)}
          />
        </Field>
        <Field label={t('expense_vat')} hint={t('expense_vat_hint')}>
          <Input
            value={vatText}
            onChange={(e) => {
              setVatText(e.target.value);
              setVatTouched(true);
            }}
            numeric
            inputMode="decimal"
            invalid={vatText.trim() !== '' && vatFils === null}
          />
        </Field>
        <div className="flex flex-col justify-end">
          <span className="mb-1.5 text-[13px] font-medium text-ink-soft">{t('expense_total')}</span>
          <span className="text-[22px] font-bold">
            <Money fils={totalFils} />
          </span>
        </div>
        <Field label={t('expense_paidOn')}>
          <DatePicker
            value={paidOn}
            onChange={setPaidOn}
            clearable
            aria-label={t('expense_paidOn')}
          />
        </Field>
        <Field label={t('expense_paymentMethod')}>
          <Select
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value as PaymentMethod | '');
            }}
          >
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`expense_payment_${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('expense_allocation')}>
          <Select
            value={scope === 'unit' ? 'single_unit' : method}
            disabled={scope === 'unit'}
            onChange={(e) => {
              setMethod(e.target.value as AllocationMethod | '');
            }}
          >
            {scope === 'unit' ? (
              <option value="single_unit">{t('expense_allocation_single_unit')}</option>
            ) : (
              <>
                <option value="">{t('expense_allocation_auto')}</option>
                {ALLOCATION_METHODS.filter((m) => m !== 'single_unit').map((m) => (
                  <option key={m} value={m}>
                    {t(`expense_allocation_${m}` as MessageKey)}
                  </option>
                ))}
              </>
            )}
          </Select>
        </Field>
        <div className="flex items-end">
          <Checkbox
            label={t('expense_visibleToOwner')}
            checked={visibleToOwner}
            onChange={(e) => {
              setVisibleToOwner(e.target.checked);
            }}
          />
        </div>
      </Card>

      {warnings?.duplicateInvoice || warnings?.outlier ? (
        <div
          role="status"
          className="rounded-md border border-status-deposited bg-status-deposited-bg px-4 py-3 text-[14px] text-status-deposited"
        >
          {warnings.duplicateInvoice ? (
            <p>
              {t('expense_warn_duplicate', { date: date(warnings.duplicateInvoice.invoiceDate) })}
            </p>
          ) : null}
          {warnings.outlier ? (
            <p>{t('expense_warn_outlier', { avg: money(warnings.outlier.averageFils) })}</p>
          ) : null}
        </div>
      ) : null}

      <section>
        <h2 className="mb-1 text-heading font-semibold">{t('expense_preview')}</h2>
        <p className="mb-3 text-[13px] text-ink-soft">{t('expense_preview_hint')}</p>
        {preview.data && preview.data.items.length > 0 && totalFils ? (
          <Card className="overflow-x-auto">
            <ResponsiveTable className="w-full min-w-[520px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="px-4 py-2 text-start font-medium">{t('unit')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('owner')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('expense_share')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.items.map((p) => (
                  <tr key={`${p.unitId}-${p.ownerId}`} className="row-line last:border-b-0">
                    <td className="px-4 py-2 tnum">{p.unitNo}</td>
                    <td className="px-4 py-2">{pick(p.nameAr, p.nameEn)}</td>
                    <td className="px-4 py-2 text-end tnum">{p.shareBp / 100}%</td>
                    <td className="px-4 py-2 text-end">
                      <Money fils={p.amountFils} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
            <p className="border-t border-line px-4 py-2 text-[13px] text-ink-soft">
              {t(`expense_allocation_${preview.data.method}` as MessageKey)} · {money(totalFils)}
            </p>
          </Card>
        ) : (
          <p className="text-[14px] text-ink-faint">{t('expense_preview_empty')}</p>
        )}
      </section>

      {error ? (
        <p role="alert" className="text-[15px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={!canSubmit} loading={busy ?? false}>
          {submitLabel}
        </Button>
        {extraActions}
      </div>

      <VendorDialog
        open={newVendor}
        onOpenChange={setNewVendor}
        onCreated={(id) => {
          setVendorId(id);
          setVatTouched(false);
        }}
      />
      <span className="hidden">{lang}</span>
    </div>
  );
}

export function VendorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const create = useCreateVendor();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [trn, setTrn] = useState('');
  const trnOk = trn.trim() === '' || /^\d{15}$/.test(trn.trim());
  async function submit() {
    // A refused vendor is reported under the fields (create.isError) and the dialog stays open.
    const r = await create
      .mutateAsync({
        name: name.trim(),
        phone: phone.trim() || null,
        trn: trn.trim() || null,
      })
      .catch(() => null);
    if (!r) return;
    onCreated(r.id);
    setName('');
    setPhone('');
    setTrn('');
    onOpenChange(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('vendor_new')}
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
          <Button
            onClick={() => void submit()}
            disabled={name.trim().length === 0 || !trnOk}
            loading={create.isPending}
          >
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('vendor_name')} required>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field label={t('vendor_phone')}>
          <Input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            numeric
            inputMode="tel"
            placeholder="+9714..."
          />
        </Field>
        <Field label={t('vendor_trn')} hint={t('vendor_trn_hint')}>
          <Input
            value={trn}
            onChange={(e) => {
              setTrn(e.target.value);
            }}
            numeric
            invalid={!trnOk}
          />
        </Field>
        {create.isError ? <p className="text-[13px] text-danger">{t('error_generic')}</p> : null}
      </div>
    </Dialog>
  );
}
