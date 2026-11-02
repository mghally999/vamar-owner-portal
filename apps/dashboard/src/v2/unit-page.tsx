import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  MANUAL_UNIT_STATUSES,
  sharePct,
  UNIT_STATUS_LABEL,
  UNIT_TYPE_LABEL,
  type ManualUnitStatus,
} from '@vamar/shared';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Dialog } from '@/ui/dialog';
import {
  Button,
  Card,
  ContractStatusChip,
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
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import { useV2, type V2MessageKey } from './messages';
import {
  useSetUnitIdentifiers,
  useSetUnitStatus,
  useUnitRecord,
  useUnitStatusHistory,
  useUnitTimeline,
} from './queries';
import { TimelineKindFilter, TimelineList, UnitStatusChip, useTimelinePages } from './shared';
import type { TimelineEntry, UnitRecord } from './types';

const IDENTIFIER_FIELDS = [
  ['titleDeedNo', 'records_titleDeed'],
  ['plotNo', 'records_plot'],
  ['makaniNo', 'records_makani'],
  ['dewaPremiseNo', 'records_dewa'],
  ['municipalityNo', 'records_municipality'],
] as const;

/** The property record of one unit: numbers, status with history, owners, contracts, timeline. */
export function UnitPage() {
  const params: { unitId?: string } = useParams({ strict: false });
  const unitId = params.unitId ?? '';
  const { t, pick, lang, date, dateTime } = useV2();
  const auth = useAuth();
  const q = useUnitRecord(unitId);
  const history = useUnitStatusHistory(unitId);
  const [changing, setChanging] = useState(false);
  const [editingIds, setEditingIds] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = auth.hasRole('editor');

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const u = q.data;

  return (
    <Page>
      <PageHeader
        title={u ? t('records_unitTitle', { no: u.unitNo }) : ''}
        subtitle={
          u ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <UnitStatusChip status={u.effectiveStatus} />
              {u.building ? (
                <Link
                  to="/buildings/$buildingId"
                  params={{ buildingId: u.building.id }}
                  className="hover:underline"
                >
                  {pick(u.building.nameAr, u.building.nameEn)}
                </Link>
              ) : null}
              <span>{UNIT_TYPE_LABEL[u.type][lang]}</span>
              {u.bedrooms ? (
                <span className="tnum">
                  {u.bedrooms} {t('records_bedrooms')}
                </span>
              ) : null}
              {u.sizeSqft ? (
                <span className="tnum">
                  {u.sizeSqft} {t('records_size')}
                </span>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-5 w-80" />
          )
        }
        actions={
          canEdit && u ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingIds(true);
                }}
              >
                {t('records_editIdentifiers')}
              </Button>
              <Button
                onClick={() => {
                  setChanging(true);
                }}
              >
                {t('records_changeStatus')}
              </Button>
            </>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}

      <section>
        <SectionTitle>{t('records_propertyNo')}</SectionTitle>
        {!u ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Card className="grid gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-2 lg:grid-cols-3">
            <Identifier
              label={t('building')}
              value={u.building ? pick(u.building.nameAr, u.building.nameEn) : null}
            />
            <Identifier label={t('unit')} value={u.unitNo} />
            {IDENTIFIER_FIELDS.map(([key, label]) => (
              <Identifier key={key} label={t(label)} value={u[key]} />
            ))}
            <Identifier
              label={t('records_handover')}
              value={u.handoverDate ? date(u.handoverDate) : null}
            />
          </Card>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>{t('records_owners')}</SectionTitle>
          {!u ? (
            <Skeleton className="h-24 w-full" />
          ) : u.owners.length === 0 ? (
            <Card className="px-5 py-6 text-[15px] text-ink-soft">{t('records_noOwners')}</Card>
          ) : (
            <Card className="overflow-hidden">
              {u.owners.map((o) => (
                <div
                  key={o.ownerId}
                  className="row-line flex flex-wrap items-center justify-between gap-2 px-4 py-3 last:border-b-0"
                >
                  <Link
                    to="/owners/$ownerId"
                    params={{ ownerId: o.ownerId }}
                    className="font-medium hover:underline"
                  >
                    {pick(o.nameAr, o.nameEn)}
                  </Link>
                  <span className="text-[13px] text-ink-soft tnum">
                    {t('records_share')} {sharePct(o.shareBp)}% · {t('records_since')}{' '}
                    {date(o.fromDate)}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </section>
        <section>
          <SectionTitle>{t('records_statusHistory')}</SectionTitle>
          {history.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : history.isError ? (
            <ErrorState onRetry={() => void history.refetch()} />
          ) : history.data.length === 0 ? (
            <Card className="px-5 py-6 text-[15px] text-ink-soft">{t('none')}</Card>
          ) : (
            <Card className="overflow-hidden">
              {history.data.map((h) => (
                <div key={h.id} className="row-line px-4 py-3 last:border-b-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px]">
                    {h.fromStatus ? <UnitStatusChip status={h.fromStatus} /> : null}
                    <span aria-hidden>→</span>
                    <UnitStatusChip status={h.toStatus} />
                  </p>
                  <p className="mt-1 text-[13px] text-ink-soft" dir="auto">
                    {h.reason}
                  </p>
                  <p className="mt-0.5 flex gap-x-3 text-[13px] text-ink-faint tnum">
                    {h.actorName ? <span>{h.actorName}</span> : null}
                    <span>{dateTime(h.at)}</span>
                  </p>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>

      <section>
        <SectionTitle>{t('records_contracts')}</SectionTitle>
        {!u ? (
          <Skeleton className="h-24 w-full" />
        ) : u.contracts.length === 0 ? (
          <Card className="px-5 py-6 text-[15px] text-ink-soft">{t('records_noContracts')}</Card>
        ) : (
          <Card className="overflow-x-auto">
            <ResponsiveTable className="w-full min-w-[640px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  <th className="px-4 py-2 text-start font-medium">{t('records_tenant')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('records_period')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('records_rent')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {u.contracts.map((c) => (
                  <tr key={c.id} className="row-line last:border-b-0">
                    <td className="px-4 py-3">
                      <Link
                        to="/contracts/$contractId"
                        params={{ contractId: c.id }}
                        className="font-medium hover:underline"
                      >
                        {c.tenantName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tnum">
                      <DateText date={c.startDate} /> – <DateText date={c.endDate} />
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Money fils={c.annualRentFils} />
                    </td>
                    <td className="px-4 py-3">
                      <ContractStatusChip status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle>{t('records_history')}</SectionTitle>
        <UnitTimeline unitId={unitId} />
      </section>

      {u && changing ? (
        <StatusDialog
          unit={u}
          onClose={() => {
            setChanging(false);
          }}
          onSaved={() => {
            setChanging(false);
            setNotice(t('records_statusChanged'));
          }}
        />
      ) : null}
      {u && editingIds ? (
        <IdentifiersDialog
          unit={u}
          onClose={() => {
            setEditingIds(false);
          }}
          onSaved={() => {
            setEditingIds(false);
            setNotice(t('records_identifiersSaved'));
          }}
        />
      ) : null}
    </Page>
  );
}

function Identifier({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[13px] text-ink-soft">{label}</p>
      <p className="text-[15px] tnum" dir="auto">
        {value ?? '—'}
      </p>
    </div>
  );
}

function UnitTimeline({ unitId }: { unitId: string }) {
  const { t } = useV2();
  const pages = useTimelinePages();
  const cursor = pages.cursors.at(-1);
  const q = useUnitTimeline(unitId, { ...pages.filter, cursor });
  const [earlier, setEarlier] = useState<TimelineEntry[]>([]);
  const [earlierKey, setEarlierKey] = useState('');
  const key = `${pages.kinds.join(',')}|${pages.cursors.length}`;
  if (earlierKey !== key) {
    // A new page was requested: keep what was shown so far; a filter change starts over.
    setEarlierKey(key);
    setEarlier(pages.cursors.length === 0 ? [] : [...earlier, ...(q.data?.items ?? [])]);
  }
  const items =
    pages.cursors.length === 0 ? (q.data?.items ?? []) : [...earlier, ...(q.data?.items ?? [])];
  const seen = new Set<string>();
  const unique = items.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-3">
      <TimelineKindFilter value={pages.kinds} onChange={pages.setKinds} />
      <TimelineList
        items={unique}
        loading={q.isPending || q.isFetching}
        hasMore={q.data?.nextCursor !== null && q.data?.nextCursor !== undefined}
        onMore={() => {
          if (q.data?.nextCursor) pages.pushCursor(q.data.nextCursor);
        }}
        emptyText={t('records_timelineEmpty')}
      />
    </div>
  );
}

function StatusDialog({
  unit,
  onClose,
  onSaved,
}: {
  unit: UnitRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useV2();
  const save = useSetUnitStatus(unit.id);
  const [status, setStatus] = useState<ManualUnitStatus>(
    unit.status === 'vacant_ready' ? 'under_maintenance' : 'vacant_ready',
  );
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setErr(null);
    try {
      await save.mutateAsync({ status, reason: reason.trim() });
      onSaved();
    } catch (e) {
      setErr(
        e instanceof ApiRequestError && e.status === 409
          ? t('records_statusSame')
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
      title={t('records_changeStatus')}
      description={t('records_statusOccupiedHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={reason.trim().length < 3}
            loading={save.isPending}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('status')} required>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ManualUnitStatus);
            }}
          >
            {MANUAL_UNIT_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === unit.status}>
                {UNIT_STATUS_LABEL[s][lang]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('reason')} hint={t('reason_hint')} required>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={3}
          />
        </Field>
        {err ? <p className="text-[13px] text-danger">{err}</p> : null}
      </div>
    </Dialog>
  );
}

function IdentifiersDialog({
  unit,
  onClose,
  onSaved,
}: {
  unit: UnitRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useV2();
  const save = useSetUnitIdentifiers(unit.id);
  const [values, setValues] = useState<Record<string, string>>({
    titleDeedNo: unit.titleDeedNo ?? '',
    plotNo: unit.plotNo ?? '',
    makaniNo: unit.makaniNo ?? '',
    dewaPremiseNo: unit.dewaPremiseNo ?? '',
    municipalityNo: unit.municipalityNo ?? '',
    handoverDate: unit.handoverDate ?? '',
  });
  const makani = values['makaniNo'] ?? '';
  const makaniOk = makani.trim() === '' || /^\d{10}$/.test(makani.trim());
  const set = (k: string, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('records_editIdentifiers')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={!makaniOk}
            loading={save.isPending}
            onClick={() =>
              void save
                .mutateAsync(
                  Object.fromEntries(
                    Object.entries(values).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
                  ),
                )
                .then(onSaved)
            }
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {IDENTIFIER_FIELDS.map(([key, label]) => (
          <Field
            key={key}
            label={t(label as V2MessageKey)}
            hint={key === 'makaniNo' ? t('records_makaniHint') : undefined}
            error={key === 'makaniNo' && !makaniOk ? t('records_makaniHint') : undefined}
          >
            <Input
              value={values[key] ?? ''}
              onChange={(e) => {
                set(key, e.target.value);
              }}
              numeric
              invalid={key === 'makaniNo' && !makaniOk}
            />
          </Field>
        ))}
        <Field label={t('records_handover')}>
          <Input
            type="date"
            value={values['handoverDate'] ?? ''}
            onChange={(e) => {
              set('handoverDate', e.target.value);
            }}
            numeric
          />
        </Field>
        {save.isError ? (
          <p className="text-[13px] text-danger sm:col-span-2">{t('error_generic')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
