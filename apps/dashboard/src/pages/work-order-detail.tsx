/**
 * One work order (or a new one): the form, the status buttons, before and after photos, and the
 * invoice that paid for it (link an existing expense or record a new one).
 */
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  todayInDubai,
  type PlainDate,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { useBuilding, useBuildings } from '@/lib/queries';
import {
  useExpenses,
  useHolidaySet,
  useSaveWorkOrder,
  useSettings,
  useVendors,
  useWorkOrder,
} from '@/lib/queries-v2';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { FileList } from '@/ui/file-list';
import {
  Button,
  Card,
  Checkbox,
  DateText,
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
import { useApprovalText } from '@/v2/approvals-messages';
import { ApprovalStateChip, ApprovalsPanel, useApprovalError } from '@/v2/approvals-panel';
import { PriorityChip, WorkOrderStatusChip } from './work-orders';

export function WorkOrderDetailPage() {
  const workOrderId = useParams({ strict: false }).workOrderId ?? '';
  const isNew = workOrderId === '';
  const { t, pick, date } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const q = useWorkOrder(workOrderId);
  const save = useSaveWorkOrder();
  const buildings = useBuildings();
  const vendors = useVendors();
  const holidays = useHolidaySet();
  const settings = useSettings();
  const ap = useApprovalText();
  const showError = useApprovalError();
  const w = q.data;

  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<WorkOrderPriority>('normal');
  const [status, setStatus] = useState<WorkOrderStatus>('open');
  const [reportedOn, setReportedOn] = useState<PlainDate | null>(todayInDubai());
  const [scheduledFor, setScheduledFor] = useState<PlainDate | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [visibleToOwner, setVisibleToOwner] = useState(true);
  /** In AED as typed; sent as integer fils, or null when empty. */
  const [estimate, setEstimate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const building = useBuilding(buildingId);
  const units = useMemo(
    () => (building.data?.units ?? []).filter((u) => u.active),
    [building.data],
  );

  useEffect(() => {
    if (!w) return;
    setBuildingId(w.buildingId);
    setUnitId(w.unitId ?? '');
    setTitleAr(w.titleAr);
    setTitleEn(w.titleEn);
    setDescription(w.description);
    setPriority(w.priority);
    setStatus(w.status);
    setReportedOn(w.reportedOn as PlainDate);
    setScheduledFor((w.scheduledFor as PlainDate | null) ?? null);
    setVendorId(w.vendorId ?? '');
    setVisibleToOwner(w.visibleToOwner);
    setEstimate(w.estimateFils === null ? '' : String(w.estimateFils / 100));
  }, [w]);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const editor = auth.hasRole('editor');
  const locked = w?.status === 'cancelled';
  const estimateText = estimate.replace(/[^0-9.]/g, '');
  const estimateFils = estimateText === '' ? null : Math.round(Number(estimateText) * 100);
  const estimateValid =
    estimateFils === null || (Number.isSafeInteger(estimateFils) && estimateFils > 0);
  const canSave =
    editor &&
    !locked &&
    estimateValid &&
    buildingId !== '' &&
    titleAr.trim() !== '' &&
    titleEn.trim() !== '' &&
    reportedOn !== null;

  async function submit(patch: Record<string, unknown> = {}) {
    if (!canSave) return;
    setError(null);
    try {
      const row = await save.mutateAsync({
        id: isNew ? undefined : workOrderId,
        input: {
          buildingId,
          unitId: unitId || null,
          titleAr: titleAr.trim(),
          titleEn: titleEn.trim(),
          description: description.trim(),
          priority,
          status,
          reportedOn,
          scheduledFor,
          vendorId: vendorId || null,
          visibleToOwner,
          estimateFils,
          ...patch,
        },
      });
      if (isNew) {
        void navigate({ to: '/work-orders/$workOrderId', params: { workOrderId: row.id } });
      } else setNotice(t('wo_saved'));
    } catch (e) {
      // A refused start (owners not yet agreed) leaves the job as it was, so the form shows that.
      if (w) setStatus(w.status);
      setError(showError(e));
    }
  }

  return (
    <Page>
      <PageHeader
        title={isNew ? t('workOrders_new') : w ? pick(w.titleAr, w.titleEn) : ''}
        subtitle={
          w ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <WorkOrderStatusChip status={w.status} />
              <PriorityChip priority={w.priority} />
              {w.approvalState !== 'none' ? <ApprovalStateChip state={w.approvalState} /> : null}
              <span>
                {pick(w.buildingNameAr, w.buildingNameEn)}
                {w.unitNo ? ` · ${w.unitNo}` : ''}
              </span>
              <span className="tnum">
                {t('wo_reportedOn')}: <DateText date={w.reportedOn} />
              </span>
              {w.completedAt ? (
                <span className="tnum">
                  {t('wo_completedAt')}: {date(w.completedAt.slice(0, 10))}
                </span>
              ) : null}
            </span>
          ) : isNew ? null : (
            <Skeleton className="h-5 w-96" />
          )
        }
        actions={
          w && editor && w.status !== 'done' && w.status !== 'cancelled' ? (
            <Button
              loading={save.isPending}
              onClick={() => {
                setStatus('done');
                void submit({ status: 'done' });
              }}
            >
              {t('wo_markDone')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {error ? <Toast kind="error">{error}</Toast> : null}
      {locked ? <Toast kind="info">{t('wo_cancelled_locked')}</Toast> : null}

      {!isNew && !w ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('building')} required>
            <Select
              value={buildingId}
              onChange={(e) => {
                setBuildingId(e.target.value);
                setUnitId('');
              }}
              disabled={!editor || locked}
            >
              <option value="">—</option>
              {buildings.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {pick(b.nameAr, b.nameEn)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('unit')} hint={t('wo_unitHint')}>
            <Select
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
              }}
              disabled={!editor || locked || !buildingId}
            >
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNo}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('wo_priority')} required>
            <Select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as WorkOrderPriority);
              }}
              disabled={!editor || locked}
            >
              {WORK_ORDER_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`wo_priority_${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('wo_titleAr')} required>
            <Input
              value={titleAr}
              onChange={(e) => {
                setTitleAr(e.target.value);
              }}
              dir="rtl"
              disabled={!editor || locked}
            />
          </Field>
          <Field label={t('wo_titleEn')} required>
            <Input
              value={titleEn}
              onChange={(e) => {
                setTitleEn(e.target.value);
              }}
              dir="ltr"
              disabled={!editor || locked}
            />
          </Field>
          <Field label={t('status')} required>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as WorkOrderStatus);
              }}
              disabled={!editor || locked}
            >
              {WORK_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`wo_status_${s}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('wo_reportedOn')} required>
            <DatePicker
              value={reportedOn}
              onChange={setReportedOn}
              disabled={!editor || locked}
              aria-label={t('wo_reportedOn')}
            />
          </Field>
          <Field label={t('wo_scheduledFor')}>
            <DatePicker
              value={scheduledFor}
              onChange={setScheduledFor}
              clearable
              holidays={holidays}
              warnNonWorking
              disabled={!editor || locked}
              aria-label={t('wo_scheduledFor')}
            />
          </Field>
          <Field
            label={ap.t('approvals_estimate')}
            hint={ap.t('approvals_estimate_hint', {
              amount: ap.money(settings.data?.repairApprovalThresholdFils ?? 500_000),
            })}
            error={estimateValid ? undefined : t('error_generic')}
          >
            <Input
              value={estimate}
              onChange={(e) => {
                setEstimate(e.target.value);
              }}
              numeric
              inputMode="decimal"
              invalid={!estimateValid}
              disabled={!editor || locked}
            />
          </Field>
          <Field label={t('wo_vendor')}>
            <Select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
              }}
              disabled={!editor || locked}
            >
              <option value="">{t('expense_vendor_none')}</option>
              {vendors.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('wo_description')}>
              <Textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                rows={3}
                disabled={!editor || locked}
              />
            </Field>
          </div>
          <div className="flex items-end">
            <Checkbox
              label={t('wo_visibleToOwner')}
              checked={visibleToOwner}
              onChange={(e) => {
                setVisibleToOwner(e.target.checked);
              }}
              disabled={!editor || locked}
            />
          </div>
          {editor && !locked ? (
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button onClick={() => void submit()} disabled={!canSave} loading={save.isPending}>
                {isNew ? t('create') : t('save')}
              </Button>
              <Button variant="secondary" onClick={() => void navigate({ to: '/work-orders' })}>
                {t('cancel')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      {w ? (
        <>
          <ApprovalsPanel kind="work_order" id={w.id} approvals={w.approvals} />
          <section>
            <SectionTitle>{t('wo_photos')}</SectionTitle>
            <FileList
              entityType="work_order"
              entityId={w.id}
              files={w.attachments}
              canEdit={editor && !locked}
              uploadLabel={t('wo_uploadPhoto')}
              emptyLabel={t('wo_noPhotos')}
            />
          </section>
          <section>
            <SectionTitle
              aside={
                editor && !locked ? (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setLinking(true);
                      }}
                    >
                      {t('wo_linkExpense')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void navigate({
                          to: '/expenses/new',
                          search: { workOrderId: w.id } as never,
                        })
                      }
                    >
                      {t('wo_createExpense')}
                    </Button>
                  </span>
                ) : null
              }
            >
              {t('wo_expense')}
            </SectionTitle>
            {w.expenseId ? (
              <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <Link
                  to="/expenses/$expenseId"
                  params={{ expenseId: w.expenseId }}
                  className="font-medium hover:underline"
                >
                  {t('wo_expense')} · {w.expenseId.slice(0, 8)}
                </Link>
                <span className="flex items-center gap-3">
                  {w.expenseStatus ? (
                    <span className="text-[13px] text-ink-soft">
                      {t(`expense_status_${w.expenseStatus}` as MessageKey)}
                    </span>
                  ) : null}
                  <Money fils={w.expenseTotalFils} strong />
                </span>
              </Card>
            ) : (
              <p className="text-[14px] text-ink-faint">{t('wo_noExpense')}</p>
            )}
          </section>
          {linking ? (
            <LinkExpenseDialog
              buildingId={w.buildingId}
              onClose={() => {
                setLinking(false);
              }}
              onPick={(expenseId) => {
                setLinking(false);
                save
                  .mutateAsync({ id: w.id, input: { expenseId } })
                  .then(() => {
                    setNotice(t('wo_linked'));
                  })
                  .catch((e: unknown) => {
                    setError(showError(e));
                  });
              }}
            />
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

function LinkExpenseDialog({
  buildingId,
  onClose,
  onPick,
}: {
  buildingId: string;
  onClose: () => void;
  onPick: (expenseId: string) => void;
}) {
  const { t, pick, money } = useI18n();
  const [text, setText] = useState('');
  const search = useDebounced(text.trim(), 300);
  const q = useExpenses({ buildingId, search: search || undefined });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('wo_linkExpense')}
      description={t('wo_pickExpense')}
    >
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        placeholder={t('expense_search')}
        aria-label={t('search')}
      />
      <ul className="mt-3 max-h-80 overflow-auto">
        {rows.map((e) => (
          <li key={e.id} className="row-line last:border-b-0">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-2 py-3 text-start hover:bg-sunken"
              onClick={() => {
                onPick(e.id);
              }}
            >
              <span>
                <span className="block font-medium" dir="auto">
                  {pick(e.reasonAr, e.reasonEn)}
                </span>
                <span className="block text-[13px] text-ink-soft tnum">
                  {e.invoiceNo ?? '—'} · {e.invoiceDate}
                </span>
              </span>
              <span className="tnum">{money(e.totalFils)}</span>
            </button>
          </li>
        ))}
        {!q.isPending && rows.length === 0 ? (
          <li className="px-2 py-3 text-[13px] text-ink-soft">{t('expenses_empty')}</li>
        ) : null}
      </ul>
    </Dialog>
  );
}
