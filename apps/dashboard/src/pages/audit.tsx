import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAudit, useStaff } from '@/lib/queries';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';
import { ResponsiveTable } from '@/ui/responsive-table';

const ENTITY_TYPES = [
  'owner',
  'building',
  'unit',
  'tenant',
  'contract',
  'cheque',
  'dispute',
  'staff_user',
  'attachment',
];

export function AuditPage() {
  const { t, dateTime } = useI18n();
  const staff = useStaff();
  const [actorId, setActorId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useAudit({
    actorId: actorId || undefined,
    entityType: entityType || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader title={t('audit_title')} />
      <div className="flex flex-wrap gap-3">
        <Select
          value={actorId}
          onChange={(e) => {
            setActorId(e.target.value);
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
            setEntityType(e.target.value);
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
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
          numeric
          className="w-44"
          aria-label={t('from')}
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
          }}
          numeric
          className="w-44"
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
                <>
                  <tr
                    key={r.id}
                    className="row-line cursor-pointer hover:bg-sunken"
                    onClick={() => {
                      setOpen(open === r.id ? null : r.id);
                    }}
                  >
                    <td className="px-4 py-3 tnum text-ink-soft">{dateTime(r.at)}</td>
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
                    <tr key={`${r.id}-detail`} className="row-line bg-sunken">
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
                </>
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
