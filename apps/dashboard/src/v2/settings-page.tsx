import { useEffect, useState } from 'react';
import { WEEK_STARTS, type WeekStart } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import {
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Toast,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { useV2 } from './messages';
import { useSettings, useUpdateSettings } from './queries';

/** Admin settings: week start, Hijri display, the fee label, the large-expense alert, invoice files. */
export function SettingsPage() {
  const { t, lib } = useV2();
  const auth = useAuth();
  const q = useSettings();
  const save = useUpdateSettings();
  const canEdit = auth.hasRole('admin');
  const [weekStart, setWeekStart] = useState<WeekStart>('monday');
  const [hijri, setHijri] = useState(false);
  const [feeLabel, setFeeLabel] = useState(true);
  const [files, setFiles] = useState(true);
  const [threshold, setThreshold] = useState('5000');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setWeekStart(q.data.weekStart);
    setHijri(q.data.hijriDisplay);
    setFeeLabel(q.data.showBeforeFeeLabel);
    setFiles(q.data.ownersSeeInvoiceFiles);
    setThreshold(String(Math.round(q.data.largeExpenseAlertFils / 100)));
  }, [q.data]);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const aed = Number(threshold.replace(/[^0-9.]/g, ''));
  const valid = Number.isFinite(aed) && aed >= 0;
  const dirty =
    !!q.data &&
    (weekStart !== q.data.weekStart ||
      hijri !== q.data.hijriDisplay ||
      feeLabel !== q.data.showBeforeFeeLabel ||
      files !== q.data.ownersSeeInvoiceFiles ||
      Math.round(aed * 100) !== q.data.largeExpenseAlertFils);

  async function submit() {
    setNotice(null);
    await save.mutateAsync({
      weekStart,
      hijriDisplay: hijri,
      showBeforeFeeLabel: feeLabel,
      ownersSeeInvoiceFiles: files,
      largeExpenseAlertFils: Math.round(aed * 100),
    });
    setNotice(t('settings_saved'));
  }

  return (
    <Page>
      <PageHeader title={t('settings_title')} subtitle={canEdit ? undefined : t('adminOnly')} />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {!q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card className="flex max-w-2xl flex-col gap-5 p-6">
          <Field label={t('settings_weekStart')} required>
            <Select
              value={weekStart}
              onChange={(e) => {
                setWeekStart(e.target.value as WeekStart);
              }}
              disabled={!canEdit}
              className="w-56"
            >
              {WEEK_STARTS.map((w) => (
                <option key={w} value={w}>
                  {t(`settings_weekStart_${w}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label={t('settings_hijri')}
            checked={hijri}
            disabled={!canEdit}
            onChange={(e) => {
              setHijri(e.target.checked);
            }}
          />
          <Checkbox
            label={t('settings_feeLabel')}
            checked={feeLabel}
            disabled={!canEdit}
            onChange={(e) => {
              setFeeLabel(e.target.checked);
            }}
          />
          <Checkbox
            label={t('settings_invoiceFiles')}
            checked={files}
            disabled={!canEdit}
            onChange={(e) => {
              setFiles(e.target.checked);
            }}
          />
          <Field
            label={t('settings_largeExpense')}
            hint={t('settings_largeExpense_hint')}
            required
            error={valid ? undefined : lib('error_generic')}
          >
            <Input
              value={threshold}
              onChange={(e) => {
                setThreshold(e.target.value);
              }}
              numeric
              inputMode="decimal"
              disabled={!canEdit}
              invalid={!valid}
              className="w-56"
            />
          </Field>
          {save.isError ? <p className="text-[13px] text-danger">{t('error_generic')}</p> : null}
          {canEdit ? (
            <div>
              <Button
                // A refused save shows its message from save.isError.
                onClick={() => void submit().catch(() => undefined)}
                disabled={!dirty || !valid}
                loading={save.isPending}
              >
                {t('save')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
    </Page>
  );
}
