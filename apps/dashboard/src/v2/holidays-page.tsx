import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { isPlainDate, todayInDubai, type PlainDate } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
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
  PageHeader,
  Select,
  SkeletonRows,
  Toast,
} from '@/ui/primitives';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import { useV2 } from './messages';
import { useDeleteHoliday, useHolidays, useUpsertHoliday } from './queries';
import type { Holiday } from './types';
import { DatePicker } from '@/ui/date-picker';

/** Public holidays per year; admins add, edit and remove them (moon-sighting dates are tentative). */
export function HolidaysPage() {
  const { t, pick } = useV2();
  const auth = useAuth();
  const thisYear = Number(todayInDubai().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useHolidays(year);
  const del = useDeleteHoliday();
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = auth.hasRole('admin');
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];

  return (
    <Page>
      <PageHeader
        title={t('holidays_title')}
        subtitle={t('holidays_hint')}
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus className="size-4" aria-hidden /> {t('holidays_new')}
            </Button>
          ) : null
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      <div>
        <Select
          value={String(year)}
          onChange={(e) => {
            setYear(Number(e.target.value));
          }}
          aria-label={t('holidays_year')}
          className="w-40"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>
      {q.isPending ? (
        <SkeletonRows cols={3} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title={t('holidays_empty')} />
      ) : (
        <Card className="overflow-x-auto">
          <ResponsiveTable className="w-full min-w-[560px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('date')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('holidays_nameAr')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('holidays_nameEn')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.data.map((h) => (
                <tr key={h.date} className="row-line last:border-b-0">
                  <td className="px-4 py-3 tnum">
                    <DateText date={h.date} />
                  </td>
                  <td className="px-4 py-3" dir="rtl">
                    {h.nameAr}
                  </td>
                  <td className="px-4 py-3" dir="ltr">
                    {h.nameEn}
                  </td>
                  <td className="px-4 py-3">
                    <span className={h.tentative ? 'text-warning' : 'text-status-cleared'}>
                      {h.tentative ? t('holidays_tentative') : t('holidays_confirmed')}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-end whitespace-nowrap">
                    {canEdit ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(h);
                          }}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${t('delete')} ${pick(h.nameAr, h.nameEn)}`}
                          onClick={() => {
                            if (window.confirm(t('holidays_deleteConfirm'))) del.mutate(h.date);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </Card>
      )}
      {editing ? (
        <HolidayDialog
          holiday={editing === 'new' ? null : editing}
          defaultYear={year}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            setNotice(t('saved'));
          }}
        />
      ) : null}
    </Page>
  );
}

function HolidayDialog({
  holiday,
  defaultYear,
  onClose,
  onSaved,
}: {
  holiday: Holiday | null;
  defaultYear: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useV2();
  const save = useUpsertHoliday();
  const [date, setDate] = useState(holiday?.date ?? `${defaultYear}-01-01`);
  const [nameAr, setNameAr] = useState(holiday?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(holiday?.nameEn ?? '');
  const [tentative, setTentative] = useState(holiday?.tentative ?? false);
  const valid = isPlainDate(date) && nameAr.trim() !== '' && nameEn.trim() !== '';
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={holiday ? t('edit') : t('holidays_new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={save.isPending}
            onClick={() =>
              void save
                .mutateAsync({ date, nameAr: nameAr.trim(), nameEn: nameEn.trim(), tentative })
                .then(onSaved)
                // A refused save shows its message from save.isError; nothing else to do.
                .catch(() => undefined)
            }
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('date')} required>
          <DatePicker
            value={date as PlainDate | ''}
            onChange={(next) => {
              setDate(next ?? '');
            }}
            required
            disabled={holiday !== null}
          />
        </Field>
        <Field label={t('holidays_nameAr')} required>
          <Input
            value={nameAr}
            onChange={(e) => {
              setNameAr(e.target.value);
            }}
            dir="rtl"
          />
        </Field>
        <Field label={t('holidays_nameEn')} required>
          <Input
            value={nameEn}
            onChange={(e) => {
              setNameEn(e.target.value);
            }}
            dir="ltr"
          />
        </Field>
        <Checkbox
          label={t('holidays_tentative')}
          checked={tentative}
          onChange={(e) => {
            setTentative(e.target.checked);
          }}
        />
        {save.isError ? <p className="text-[13px] text-danger">{t('error_generic')}</p> : null}
      </div>
    </Dialog>
  );
}
