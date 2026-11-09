/**
 * Recurring rules for fixed costs: the list with the next due date, a dialog to create or edit a
 * rule, pause and resume. The daily job turns each due date into a draft expense.
 */
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  ALLOCATION_METHODS,
  RECURRING_FREQUENCIES,
  formatNumber,
  nextDueDate,
  parseAmountInput,
  todayInDubai,
  vatFor,
  type AllocationMethod,
  type PlainDate,
  type RecurringFrequency,
} from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useBuilding, useBuildings } from '@/lib/queries';
import { useCategories, useRules, useSaveRule, useVendors } from '@/lib/queries-v2';
import type { RecurringRule } from '@/lib/types-v2';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  Checkbox,
  DateText,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  Toast,
  cx,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';

const aed = (fils: number | null | undefined) =>
  fils === null || fils === undefined ? '' : formatNumber(fils, 'en').replace(/,/g, '');

export function ExpenseRulesPage() {
  const { t, pick, lang } = useI18n();
  const auth = useAuth();
  const [includeInactive, setIncludeInactive] = useState(false);
  const q = useRules({ includeInactive: includeInactive ? '1' : undefined });
  const save = useSaveRule();
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const today = todayInDubai();

  return (
    <Page>
      <PageHeader
        title={t('rules_title')}
        subtitle={t('rules_hint')}
        actions={
          <>
            <Link to="/expenses" className="text-[14px] text-ink-soft hover:text-ink">
              {t('expenses_title')}
            </Link>
            {auth.hasRole('editor') ? (
              <Button
                onClick={() => {
                  setEditing('new');
                }}
              >
                {t('rules_new')}
              </Button>
            ) : null}
          </>
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {failure ? <Toast kind="error">{failure}</Toast> : null}
      <Checkbox
        label={t('rule_paused')}
        checked={includeInactive}
        onChange={(e) => {
          setIncludeInactive(e.target.checked);
        }}
      />
      {q.isPending ? (
        <SkeletonRows cols={5} rows={6} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title={t('rules_empty')} />
      ) : (
        <Card className="overflow-x-auto">
          <ResponsiveTable className="w-full min-w-[900px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('expense_reason')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('building')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('expense_category')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('rule_frequency')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('expense_total')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('rule_nextDue')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                {auth.hasRole('editor') ? <th className="px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => {
                const next = r.active
                  ? nextDueDate(
                      {
                        frequency: r.frequency,
                        dayOfMonth: r.dayOfMonth,
                        startDate: r.startDate as PlainDate,
                        endDate: r.endDate as PlainDate | null,
                      },
                      today,
                    )
                  : null;
                return (
                  <tr key={r.id} className="row-line last:border-b-0">
                    <td className="px-4 py-3 font-medium" dir="auto">
                      {pick(r.reasonAr, r.reasonEn)}
                      {r.vendorName ? (
                        <span className="block text-[13px] font-normal text-ink-soft">
                          {r.vendorName}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {pick(r.buildingNameAr, r.buildingNameEn)}
                      {r.unitNo ? ` · ${r.unitNo}` : ''}
                    </td>
                    <td className="px-4 py-3">{pick(r.categoryNameAr, r.categoryNameEn)}</td>
                    <td className="px-4 py-3">
                      {t(`rule_frequency_${r.frequency}`)} · {r.dayOfMonth}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Money fils={r.amountFils + r.vatFils} />
                    </td>
                    <td className="px-4 py-3 tnum">{next ? <DateText date={next} /> : '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cx(
                          'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
                          r.active
                            ? 'bg-status-cleared-bg text-status-cleared'
                            : 'bg-status-cancelled-bg text-status-cancelled',
                        )}
                      >
                        {r.active ? t('rule_active') : t('rule_paused')}
                      </span>
                    </td>
                    {auth.hasRole('editor') ? (
                      <td className="px-2 py-3 text-end whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(r);
                          }}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={save.isPending && save.variables.id === r.id}
                          onClick={() => {
                            setFailure(null);
                            save
                              .mutateAsync({ id: r.id, input: { active: !r.active } })
                              .then(() => {
                                setNotice(t('rule_saved'));
                              })
                              .catch((e: unknown) => {
                                // A refused pause or resume says why instead of doing nothing.
                                setNotice(null);
                                setFailure(
                                  e instanceof ApiRequestError ? e.message : t('error_generic'),
                                );
                              });
                          }}
                        >
                          {r.active ? t('rule_pause') : t('rule_resume')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </ResponsiveTable>
        </Card>
      )}
      {editing ? (
        <RuleDialog
          rule={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            setNotice(t('rule_saved'));
          }}
        />
      ) : null}
      <span className="hidden">{lang}</span>
    </Page>
  );
}

function RuleDialog({
  rule,
  onClose,
  onSaved,
}: {
  rule: RecurringRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, pick } = useI18n();
  const buildings = useBuildings();
  const categories = useCategories();
  const vendors = useVendors();
  const save = useSaveRule();
  const [scope, setScope] = useState<'building' | 'unit'>(rule?.scope ?? 'building');
  const [buildingId, setBuildingId] = useState(rule?.buildingId ?? '');
  const [unitId, setUnitId] = useState(rule?.unitId ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '');
  const [vendorId, setVendorId] = useState(rule?.vendorId ?? '');
  const [reasonAr, setReasonAr] = useState(rule?.reasonAr ?? '');
  const [reasonEn, setReasonEn] = useState(rule?.reasonEn ?? '');
  const [amountText, setAmountText] = useState(aed(rule?.amountFils));
  const [vatText, setVatText] = useState(aed(rule?.vatFils));
  const [vatTouched, setVatTouched] = useState(rule !== null);
  const [frequency, setFrequency] = useState<RecurringFrequency>(rule?.frequency ?? 'monthly');
  const [dayOfMonth, setDayOfMonth] = useState(rule?.dayOfMonth ?? 1);
  const [startDate, setStartDate] = useState<PlainDate | null>(
    (rule?.startDate as PlainDate | undefined) ?? todayInDubai(),
  );
  const [endDate, setEndDate] = useState<PlainDate | null>(
    (rule?.endDate as PlainDate | null | undefined) ?? null,
  );
  const [method, setMethod] = useState<AllocationMethod | ''>(rule?.allocationMethod ?? '');
  const [visibleToOwner, setVisibleToOwner] = useState(rule?.visibleToOwner ?? true);
  const [error, setError] = useState<string | null>(null);
  const building = useBuilding(buildingId);
  const units = useMemo(
    () => (building.data?.units ?? []).filter((u) => u.active),
    [building.data],
  );
  const vendor = vendors.data?.find((v) => v.id === vendorId);
  const amountFils = parseAmountInput(amountText);
  const vatFils = vatText.trim() === '' ? 0 : parseAmountInput(vatText);
  const suggestedVat = amountFils !== null && vendor?.trn ? aed(vatFor(amountFils)) : '0';
  const effectiveVat = vatTouched ? vatText : suggestedVat;
  const effectiveVatFils = effectiveVat.trim() === '' ? 0 : parseAmountInput(effectiveVat);
  const canSubmit =
    buildingId !== '' &&
    (scope === 'building' || unitId !== '') &&
    categoryId !== '' &&
    reasonAr.trim() !== '' &&
    reasonEn.trim() !== '' &&
    amountFils !== null &&
    amountFils > 0 &&
    effectiveVatFils !== null &&
    startDate !== null &&
    (endDate === null || endDate >= startDate);

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    try {
      await save.mutateAsync({
        id: rule?.id,
        input: {
          scope,
          buildingId,
          unitId: scope === 'unit' ? unitId : null,
          categoryId,
          vendorId: vendorId || null,
          reasonAr: reasonAr.trim(),
          reasonEn: reasonEn.trim(),
          amountFils,
          vatFils: effectiveVatFils,
          frequency,
          dayOfMonth,
          startDate,
          endDate,
          ...(scope === 'unit'
            ? { allocationMethod: 'single_unit' }
            : method
              ? { allocationMethod: method }
              : {}),
          visibleToOwner,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={rule ? t('edit') : t('rules_new')}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} loading={save.isPending}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('expense_scope')} required>
          <Select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as 'building' | 'unit');
              if (e.target.value === 'building') setUnitId('');
            }}
          >
            <option value="building">{t('expense_scope_building')}</option>
            <option value="unit">{t('expense_scope_unit')}</option>
          </Select>
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
        {scope === 'unit' ? (
          <Field label={t('unit')} required>
            <Select
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
              }}
              disabled={!buildingId}
            >
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNo}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('expense_category')} required>
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
            }}
          >
            <option value="">{t('expense_category_pick')}</option>
            {(categories.data ?? [])
              .filter((c) => c.kind === 'fixed')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.nameAr, c.nameEn)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('expense_vendor')}>
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
              </option>
            ))}
          </Select>
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
        <Field label={t('rule_amount')} required>
          <Input
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
            }}
            numeric
            inputMode="decimal"
            invalid={amountText.trim() !== '' && (amountFils === null || amountFils === 0)}
          />
        </Field>
        <Field label={t('expense_vat')} hint={t('expense_vat_hint')}>
          <Input
            value={effectiveVat}
            onChange={(e) => {
              setVatText(e.target.value);
              setVatTouched(true);
            }}
            numeric
            inputMode="decimal"
            invalid={vatFils === null && vatTouched}
          />
        </Field>
        <Field label={t('rule_frequency')} required>
          <Select
            value={frequency}
            onChange={(e) => {
              setFrequency(e.target.value as RecurringFrequency);
            }}
          >
            {RECURRING_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`rule_frequency_${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('rule_dayOfMonth')} required>
          <Select
            value={dayOfMonth}
            onChange={(e) => {
              setDayOfMonth(Number(e.target.value));
            }}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('rule_startDate')} required>
          <DatePicker value={startDate} onChange={setStartDate} aria-label={t('rule_startDate')} />
        </Field>
        <Field label={t('rule_endDate')} hint={t('rule_endDate_hint')}>
          <DatePicker
            value={endDate}
            onChange={setEndDate}
            clearable
            min={startDate ?? undefined}
            aria-label={t('rule_endDate')}
          />
        </Field>
        {scope === 'building' ? (
          <Field label={t('expense_allocation')}>
            <Select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as AllocationMethod | '');
              }}
            >
              <option value="">{t('expense_allocation_auto')}</option>
              {ALLOCATION_METHODS.filter((m) => m !== 'single_unit').map((m) => (
                <option key={m} value={m}>
                  {t(`expense_allocation_${m}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="flex items-end">
          <Checkbox
            label={t('expense_visibleToOwner')}
            checked={visibleToOwner}
            onChange={(e) => {
              setVisibleToOwner(e.target.checked);
            }}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
