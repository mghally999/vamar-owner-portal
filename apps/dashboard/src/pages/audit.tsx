import { Fragment, useState } from 'react';
import { isPlainDate, type PlainDate } from '@vamar/shared';
import { useUrlFilters } from '@/lib/url-filters';
import { useI18n } from '@/lib/i18n';
import { useAudit, useStaff } from '@/lib/queries';
import { DatePicker } from '@/ui/date-picker';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  SkeletonRows,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { ResponsiveTable } from '@/ui/responsive-table';

/**
 * Every entity type the API writes to the audit log (apps/api/src/services: audit(... entityType)).
 * The filter used to stop at the first release's records, so an owner's answer to a repair
 * approval, a work order, an expense or a budget change could not be filtered for.
 */
export const ENTITY_TYPES = [
  'owner',
  'building',
  'unit',
  'tenant',
  'contract',
  'cheque',
  'dispute',
  'expense',
  'expense_category',
  'recurring_rule',
  'vendor',
  'work_order',
  'repair_approval',
  'budget',
  'message_thread',
  'message',
  'calendar_event',
  'holiday',
  'settings',
  'import',
  'staff_user',
  'attachment',
];

/** Kept in the URL so a reload or a shared link shows the same entries. */
const FILTERS = { actorId: '', entityType: '', from: '', to: '' };

export function AuditPage() {
  const { t, dateTime } = useI18n();
  const staff = useStaff();
  const [filters, setFilters] = useUrlFilters(FILTERS);
  const { actorId, entityType } = filters;
  const from: PlainDate | null = isPlainDate(filters.from) ? filters.from : null;
  const to: PlainDate | null = isPlainDate(filters.to) ? filters.to : null;
  const [open, setOpen] = useState<string | null>(null);
  const q = useAudit({
    actorId: actorId || undefined,
    entityType: entityType || undefined,
    from: from ?? undefined,
    to: to ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader title={t('audit_title')} />
      <div className="flex flex-wrap gap-3">
        <Select
          value={actorId}
          onChange={(e) => {
            setFilters({ actorId: e.target.value });
          }}
          className="w-52"
          aria-label={t('audit_actor')}
        >
          <option value="">
            {t('audit_actor')}: {t('all')}
          </option>
          {staff.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          value={entityType}
          onChange={(e) => {
            setFilters({ entityType: e.target.value });
          }}
          className="w-48"
          aria-label={t('audit_entity')}
        >
          <option value="">
            {t('audit_entity')}: {t('all')}
          </option>
          {ENTITY_TYPES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
        <DatePicker
          value={from}
          onChange={(d) => {
            setFilters({ from: d ?? '' });
          }}
          clearable
          className="w-56"
          aria-label={t('from')}
        />
        <DatePicker
          value={to}
          onChange={(d) => {
            setFilters({ to: d ?? '' });
          }}
          clearable
          className="w-56"
          aria-label={t('to')}
        />
      </div>
      {q.isPending ? (
        <SkeletonRows cols={4} rows={8} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('audit_empty')} />
      ) : (
        <Card className="overflow-x-auto">
          <ResponsiveTable className="w-full min-w-[760px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('audit_when')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('audit_actor')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('audit_action')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('audit_entity')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className="row-line cursor-pointer hover:bg-sunken"
                    onClick={() => {
                      setOpen(open === r.id ? null : r.id);
                    }}
                  >
                    <td className="px-4 py-3 tnum text-ink-soft">
                      {/* The row opens on a click anywhere; the button gives keyboards the same. */}
                      <button
                        type="button"
                        aria-expanded={open === r.id}
                        aria-controls={open === r.id ? `audit-${r.id}` : undefined}
                        className="min-h-6 text-start hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(open === r.id ? null : r.id);
                        }}
                      >
                        {dateTime(r.at)}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {r.actorType === 'system' ? t('audit_system') : (r.actorName ?? r.actorType)}
                    </td>
                    <td className="px-4 py-3 font-medium" dir="ltr">
                      {r.action}
                    </td>
                    <td className="px-4 py-3 text-ink-soft" dir="ltr">
                      {r.entityType}
                      {r.entityId ? (
                        <span className="text-ink-faint tnum"> · {r.entityId.slice(0, 8)}</span>
                      ) : null}
                    </td>
                  </tr>
                  {open === r.id ? (
                    <tr id={`audit-${r.id}`} className="row-line bg-sunken">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-2" dir="ltr">
                          <div>
                            <p className="mb-1 text-[13px] font-medium text-ink-soft">
                              {t('audit_before')}
                            </p>
                            <pre className="max-h-72 overflow-auto rounded-sm bg-elevated p-3 text-[13px]">
                              {r.before ? JSON.stringify(r.before, null, 2) : '—'}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-[13px] font-medium text-ink-soft">
                              {t('audit_after')}
                            </p>
                            <pre className="max-h-72 overflow-auto rounded-sm bg-elevated p-3 text-[13px]">
                              {r.after ? JSON.stringify(r.after, null, 2) : '—'}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </ResponsiveTable>
          {q.hasNextPage ? (
            <div className="border-t border-line p-3">
              <Button
                variant="secondary"
                size="sm"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
    </Page>
  );
}
