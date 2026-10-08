import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonthsClamped,
  generateChequeSchedule,
  parseAmountInput,
  todayInDubai,
  type PlainDate,
} from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  useBuilding,
  useBuildings,
  useCreateContract,
  useCreateTenant,
  useTenants,
} from '@/lib/queries';
import { ChequeGrid, toGridRows, type GridRowDraft } from '@/ui/cheque-grid';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

export function ContractNewPage() {
  const { t, pick } = useI18n();
  const navigate = useNavigate();
  const buildings = useBuildings();
  const [buildingId, setBuildingId] = useState('');
  const building = useBuilding(buildingId);
  const [showAll, setShowAll] = useState(false);
  const [unitId, setUnitId] = useState('');
  const tenants = useTenants();
  const [tenantId, setTenantId] = useState('');
  const [newTenant, setNewTenant] = useState(false);
  const today = todayInDubai();
  const [startDate, setStartDate] = useState<PlainDate>(today);
  const [endDate, setEndDate] = useState<PlainDate>(addDays(addMonthsClamped(today, 12), -1));
  const [rentText, setRentText] = useState('');
  const [chequeCount, setChequeCount] = useState(4);
  const [ejari, setEjari] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<GridRowDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateContract();

  const rentFils = parseAmountInput(rentText) ?? 0;
  const datesValid = endDate >= startDate;

  // Regenerate the schedule when dates or count change; keep typed amounts by seq.
  useEffect(() => {
    if (!datesValid) return;
    const schedule = generateChequeSchedule({ startDate, endDate, chequeCount });
    setRows((prev) =>
      schedule.map((s) => ({
        seq: s.seq,
        dueDate: s.dueDate,
        amountText: prev[s.seq - 1]?.amountText ?? '',
        chequeNo: prev[s.seq - 1]?.chequeNo ?? '',
        bankName: prev[s.seq - 1]?.bankName ?? '',
      })),
    );
  }, [startDate, endDate, chequeCount, datesValid]);

  const units = useMemo(
    () => (building.data?.units ?? []).filter((u) => u.active && (showAll || !u.occupied)),
    [building.data, showAll],
  );

  const canSave =
    buildingId && unitId && tenantId && datesValid && rentFils > 0 && rows.length === chequeCount;

  async function submit() {
    setError(null);
    try {
      const r = await create.mutateAsync({
        unitId,
        tenantId,
        startDate,
        endDate,
        annualRentFils: rentFils,
        chequeCount,
        ejariNo: ejari.trim() || null,
        notes: notes.trim(),
        cheques: toGridRows(rows).map((g) => ({
          ...g,
          amountFils: g.amountFils && g.amountFils > 0 ? g.amountFils : null,
        })),
      });
      void navigate({ to: '/contracts/$contractId', params: { contractId: r.id } });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t('error_generic'));
    }
  }

  return (
    <Page>
      <PageHeader title={t('contracts_new')} />
      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
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
        <Field label={t('unit')} required hint={t('contract_unitHint')}>
          <Select
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
            }}
            disabled={!buildingId}
          >
            <option value="">{t('contract_pickUnit')}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNo} {u.occupied ? `· ${t('unit_occupied')}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Checkbox
            label={t('contract_showAllUnits')}
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
            }}
          />
        </div>
        <Field label={t('tenant')} required>
          <div className="flex gap-2">
            <Select
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
              }}
            >
              <option value="">{t('tenant_pick')}</option>
              {tenants.data?.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.name}
                  {tn.company ? ` · ${tn.company}` : ''}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => {
                setNewTenant(true);
              }}
              aria-label={t('tenant_new')}
              className="shrink-0 px-3"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </Field>
        <Field label={t('contract_start')} required>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value as PlainDate);
            }}
            numeric
          />
        </Field>
        <Field
          label={t('contract_end')}
          required
          error={datesValid ? undefined : t('error_generic')}
        >
          <Input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value as PlainDate);
            }}
            numeric
            invalid={!datesValid}
          />
        </Field>
        <Field label={t('contract_rent')} required>
          <Input
            value={rentText}
            onChange={(e) => {
              setRentText(e.target.value);
            }}
            numeric
            inputMode="decimal"
            placeholder="85,000"
          />
        </Field>
        <Field label={t('contract_chequeCount')} required>
          <Select
            value={chequeCount}
            onChange={(e) => {
              setChequeCount(Number(e.target.value));
            }}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('contract_ejari')}>
          <Input
            value={ejari}
            onChange={(e) => {
              setEjari(e.target.value);
            }}
            numeric
          />
        </Field>
        <Field label={t('notes')}>
          <Input
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </Field>
      </Card>

      <section>
        <SectionTitle>{t('contract_grid_title')}</SectionTitle>
        <p className="mb-3 text-[13px] text-ink-soft">{t('contract_grid_hint')}</p>
        {rows.length ? (
          <ChequeGrid rows={rows} annualRentFils={rentFils} onChange={setRows} />
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-[15px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void submit()} disabled={!canSave} loading={create.isPending}>
          {t('contract_saveDraft')}
        </Button>
        <Button variant="secondary" onClick={() => void navigate({ to: '/contracts' })}>
          {t('cancel')}
        </Button>
      </div>

      <TenantDialog
        open={newTenant}
        onOpenChange={setNewTenant}
        onCreated={(id) => {
          setTenantId(id);
        }}
      />
    </Page>
  );
}

export function TenantDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const create = useCreateTenant();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  async function submit() {
    const r = await create.mutateAsync({
      name: name.trim(),
      phone: phone.trim() || null,
      company: company.trim() || null,
    });
    onCreated(r.id);
    setName('');
    setPhone('');
    setCompany('');
    onOpenChange(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('tenant_new')}
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
            disabled={name.trim().length === 0}
            loading={create.isPending}
          >
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('tenant_name')} required>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field label={t('tenant_phone')}>
          <Input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            numeric
            inputMode="tel"
            placeholder="+9715..."
          />
        </Field>
        <Field label={t('tenant_company')}>
          <Input
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
            }}
          />
        </Field>
        {create.isError ? <p className="text-[13px] text-danger">{t('error_generic')}</p> : null}
      </div>
    </Dialog>
  );
}
