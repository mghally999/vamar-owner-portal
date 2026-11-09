import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  DISPUTE_STATUSES,
  DISPUTE_TYPES,
  DISPUTE_TYPE_LABEL,
  DISPUTE_STATUS_LABEL,
  parseAmountInput,
  type DisputeStatus,
  type DisputeType,
  type PlainDate,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { prefetchDispute, useBuilding, useBuildings, useCreateDispute } from '@/lib/queries';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  DateText,
  DisputeStatusChip,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { ResponsiveTable } from '@/ui/responsive-table';
import { useV2 } from '@/v2/messages';
import { useDisputesV2, useUnitCheques } from '@/v2/queries';
import { ChequePicker } from '@/v2/cheque-picker';
import { DatePicker } from '@/ui/date-picker';
import { useHolidaySet } from '@/lib/queries-v2';

export function DisputesPage() {
  const { t, pick, lang } = useI18n();
  const { t: tv2 } = useV2();
  const auth = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<DisputeStatus | ''>('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 300);
  const [creating, setCreating] = useState(false);
  const q = useDisputesV2({ status: status || undefined, search: debounced || undefined });

  return (
    <Page>
      <PageHeader
        title={t('disputes_title')}
        actions={
          auth.hasRole('editor') ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('disputes_new')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as DisputeStatus | '');
          }}
          className="w-48"
          aria-label={t('status')}
        >
          <option value="">{t('all')}</option>
          {DISPUTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DISPUTE_STATUS_LABEL[s][lang]}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          placeholder={tv2('disputes_search')}
          aria-label={tv2('disputes_search')}
          numeric
          className="w-64"
        />
      </div>
      {q.isPending ? (
        <SkeletonRows cols={5} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          title={t('disputes_empty')}
          action={
            auth.hasRole('editor') ? (
              <Button
                onClick={() => {
                  setCreating(true);
                }}
              >
                {t('disputes_new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <ResponsiveTable className="w-full min-w-[800px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('dispute_case')}</th>
                <th className="px-4 py-2 text-start font-medium">{tv2('disputes_chequeNos')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('unit')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('dispute_type')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('tenant')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('dispute_claimed')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('dispute_hearing')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr
                  key={d.id}
                  className="row-line hover:bg-sunken last:border-b-0"
                  onMouseEnter={() => {
                    prefetchDispute(qc, d.id);
                  }}
                >
                  <td className="px-4 py-3 tnum">
                    <Link
                      to="/disputes/$disputeId"
                      params={{ disputeId: d.id }}
                      className="font-medium hover:underline"
                    >
                      {d.caseNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tnum" dir="ltr">
                    {d.chequeNos.length === 0 ? '—' : d.chequeNos.join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    {pick(d.buildingNameAr, d.buildingNameEn)} · {d.unitNo}
                  </td>
                  <td className="px-4 py-3">{DISPUTE_TYPE_LABEL[d.type][lang]}</td>
                  <td className="px-4 py-3 text-ink-soft">{d.tenantName ?? '—'}</td>
                  <td className="px-4 py-3 text-end">
                    <Money fils={d.amountClaimedFils} />
                  </td>
                  <td className="px-4 py-3">
                    <DateText date={d.nextHearingDate} />
                  </td>
                  <td className="px-4 py-3">
                    <DisputeStatusChip status={d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </Card>
      )}
      <DisputeDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}

function DisputeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t, pick, lang } = useI18n();
  const { t: tv2 } = useV2();
  const create = useCreateDispute();
  const buildings = useBuildings();
  const [buildingId, setBuildingId] = useState('');
  const building = useBuilding(buildingId);
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState<DisputeType>('rent_arrears');
  const [chequeIds, setChequeIds] = useState<string[]>([]);
  const unitCheques = useUnitCheques(unitId);
  const [amount, setAmount] = useState('');
  const [hearing, setHearing] = useState('');
  const holidaySet = useHolidaySet();
  const [notes, setNotes] = useState('');
  const units = useMemo(() => building.data?.units ?? [], [building.data]);
  const unit = units.find((u) => u.id === unitId);

  async function submit() {
    await create.mutateAsync({
      unitId,
      contractId: unit?.contract?.id ?? null,
      tenantId: null,
      type,
      amountClaimedFils: amount.trim() ? parseAmountInput(amount) : null,
      nextHearingDate: hearing || null,
      notes: notes.trim(),
      chequeIds,
    });
    onOpenChange(false);
    setUnitId('');
    setChequeIds([]);
    setAmount('');
    setHearing('');
    setNotes('');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('disputes_new')}
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
            disabled={!unitId || (type === 'bounced_cheque' && chequeIds.length === 0)}
            loading={create.isPending}
          >
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
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
        <Field label={t('unit')} required>
          <Select
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
              setChequeIds([]);
            }}
            disabled={!buildingId}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNo}
                {u.contract ? ` · ${u.contract.tenantName}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('dispute_type')} required>
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as DisputeType);
            }}
          >
            {DISPUTE_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {DISPUTE_TYPE_LABEL[ty][lang]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('dispute_claimed')} (${t('aed')})`}>
          <Input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            numeric
            inputMode="decimal"
          />
        </Field>
        <Field label={t('dispute_hearing')}>
          <DatePicker
            value={hearing as PlainDate | ''}
            onChange={(next) => {
              setHearing(next ?? '');
            }}
            clearable
            warnNonWorking
            holidays={holidaySet}
          />
        </Field>
        {unitId ? (
          <div className="sm:col-span-2">
            <ChequePicker
              cheques={unitCheques.data ?? []}
              loading={unitCheques.isPending}
              value={chequeIds}
              onChange={setChequeIds}
              required={type === 'bounced_cheque'}
            />
            {type === 'bounced_cheque' && chequeIds.length === 0 ? (
              <p className="mt-1 text-[13px] text-danger">{tv2('disputes_needCheque')}</p>
            ) : null}
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field label={t('dispute_internalNotes')}>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={3}
            />
          </Field>
        </div>
        {create.isError ? (
          <p className="text-[13px] text-danger sm:col-span-2">{t('error_generic')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
