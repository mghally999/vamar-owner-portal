import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { ContractStatus } from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { prefetchContract, useBuildings, useContracts } from '@/lib/queries';
import {
  Button,
  Card,
  ContractStatusChip,
  DateText,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
} from '@/ui/primitives';
import { Page } from '@/ui/shell';

const STATUSES: ContractStatus[] = ['draft', 'active', 'expired', 'terminated', 'renewed'];

export function ContractsPage() {
  const { t, pick } = useI18n();
  const auth = useAuth();
  const qc = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema yet
  const search = useSearch({ strict: false }) as { endingWithinDays?: number };
  const [status, setStatus] = useState<ContractStatus | ''>('');
  const [buildingId, setBuildingId] = useState('');
  const [ending, setEnding] = useState(Boolean(search.endingWithinDays));
  const buildings = useBuildings();
  const q = useContracts({
    status: status || undefined,
    buildingId: buildingId || undefined,
    endingWithinDays: ending ? 60 : undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader
        title={t('contracts_title')}
        actions={
          auth.hasRole('editor') ? (
            <Button asChild>
              <Link to="/contracts/new">
                <Plus className="size-4" aria-hidden /> {t('contracts_new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ContractStatus | '');
          }}
          className="w-44"
          aria-label={t('status')}
        >
          <option value="">{t('all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`contract_status_${s}` as MessageKey)}
            </option>
          ))}
        </Select>
        <Select
          value={buildingId}
          onChange={(e) => {
            setBuildingId(e.target.value);
          }}
          className="w-56"
          aria-label={t('building')}
        >
          <option value="">{t('all')}</option>
          {buildings.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {pick(b.nameAr, b.nameEn)}
            </option>
          ))}
        </Select>
        <label className="inline-flex h-11 items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={ending}
            onChange={(e) => {
              setEnding(e.target.checked);
            }}
          />
          {t('overview_ending')}
        </label>
      </div>

      {q.isPending ? (
        <SkeletonRows cols={5} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('contracts_empty')} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-[15px]">
            <thead>
              <tr className="row-line text-[13px] text-ink-soft">
                <th className="px-4 py-2 text-start font-medium">{t('unit')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('tenant')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('contract_start')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('contract_end')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('contract_rent')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('contract_chequeCount')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="row-line hover:bg-sunken last:border-b-0"
                  onMouseEnter={() => {
                    prefetchContract(qc, c.id);
                  }}
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/contracts/$contractId"
                      params={{ contractId: c.id }}
                      className="font-medium hover:underline"
                    >
                      {pick(c.buildingNameAr, c.buildingNameEn)} · {c.unitNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.tenantName}</td>
                  <td className="px-4 py-3">
                    <DateText date={c.startDate} />
                  </td>
                  <td className="px-4 py-3">
                    <DateText date={c.endDate} />
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Money fils={c.annualRentFils} />
                  </td>
                  <td className="px-4 py-3 tnum">{c.chequeCount}</td>
                  <td className="px-4 py-3">
                    <ContractStatusChip status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
