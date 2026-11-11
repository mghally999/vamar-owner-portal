/**
 * Expenses list: period bar, tabs (all, drafts queue, posted), filters (building, unit, category,
 * kind, status, vendor, search), the totals of the filtered set, and a link to the recurring rules.
 * Rows staff can act on have a checkbox; the bulk bar posts or deletes drafts and shows or hides
 * posted expenses from the owners.
 */
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import {
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
  type BulkExpenseAction,
  type ExpenseKind,
  type ExpenseStatus,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useExpenseBulkI18n } from '@/lib/expense-bulk-messages';
import { useDebounced } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { usePeriodSearch } from '@/lib/period-search';
import { useBuilding, useBuildings } from '@/lib/queries';
import { useCategories, useExpenses, useHolidaySet, useVendors } from '@/lib/queries-v2';
import { PeriodBar } from '@/ui/period-bar';
import {
  Button,
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Input,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  Toast,
  cx,
} from '@/ui/primitives';
import { ExpenseBulkBar, ExpenseBulkDialog, actionsFor } from '@/ui/expense-bulk';
import { ResponsiveTable } from '@/ui/responsive-table';
import { Page } from '@/ui/shell';
import {
  ApprovalStateChip,
  AwaitingApprovalToggle,
  useAwaitingApprovalFilter,
} from '@/v2/approvals-panel';

const expenseChip: Record<ExpenseStatus, string> = {
  draft: 'bg-status-upcoming-bg text-status-upcoming',
  posted: 'bg-status-cleared-bg text-status-cleared',
  void: 'bg-status-cancelled-bg text-status-cancelled',
};

export function ExpenseStatusChip({ status }: { status: ExpenseStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium',
        expenseChip[status],
      )}
    >
      {t(`expense_status_${status}`)}
    </span>
  );
}

export function KindChip({ kind }: { kind: ExpenseKind }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-6 items-center rounded-sm bg-chip px-2 text-[13px] font-medium text-on-chip">
      {t(`expense_kind_${kind}`)}
    </span>
  );
}

export function ExpensesPage() {
  const { t, pick, money, num, date } = useI18n();
  const { tb } = useExpenseBulkI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- routes carry no search schema
  const search = useSearch({ strict: false }) as {
    status?: string;
    buildingId?: string;
    kind?: string;
  };
  const period = usePeriodSearch('this_month');
  const holidays = useHolidaySet();
  const [tab, setTab] = useState<'all' | 'draft' | 'posted'>(
    search.status === 'draft' ? 'draft' : search.status === 'posted' ? 'posted' : 'all',
  );
  const [buildingId, setBuildingId] = useState(search.buildingId ?? '');
  const [unitId, setUnitId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState<ExpenseKind | ''>(
    search.kind === 'fixed' || search.kind === 'variable' ? search.kind : '',
  );
  const [status, setStatus] = useState<ExpenseStatus | ''>('');
  const [vendorId, setVendorId] = useState('');
  const [text, setText] = useState('');
  const searchText = useDebounced(text.trim(), 300);
  const buildings = useBuildings();
  const building = useBuilding(buildingId);
  const categories = useCategories();
  const vendors = useVendors();
  const [awaiting, toggleAwaiting] = useAwaitingApprovalFilter();
  // Kept with each id so the actions and the refusal names do not depend on the rows in view.
  const [selected, setSelected] = useState<Map<string, { status: ExpenseStatus; label: string }>>(
    new Map(),
  );
  const [bulkAction, setBulkAction] = useState<BulkExpenseAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filters = {
    // Drafts waiting for the owners are shown whatever their invoice date.
    ...(awaiting ? {} : period.query),
    approval: awaiting ? 'awaiting' : undefined,
    buildingId: buildingId || undefined,
    unitId: unitId || undefined,
    categoryId: categoryId || undefined,
    kind: kind || undefined,
    status: tab === 'all' ? status || undefined : tab,
    vendorId: vendorId || undefined,
    search: searchText || undefined,
  };
  const q = useExpenses(filters);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = q.data?.pages[0]?.totals;

  const canEdit = auth.hasRole('editor');
  const isAdmin = auth.hasRole('admin');
  // Drafts are posted or deleted by editors; showing or hiding a posted one is for admins.
  const selectable = (e: { status: ExpenseStatus }) =>
    (e.status === 'draft' && canEdit) || (e.status === 'posted' && isAdmin);
  const rowLabel = (e: (typeof rows)[number]) =>
    `${pick(e.reasonAr, e.reasonEn)} · ${date(e.invoiceDate)}`;
  const selectableRows = rows.filter(selectable);
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));
  const someSelected = selectableRows.some((r) => selected.has(r.id));
  const toggle = (e: (typeof rows)[number]) => {
    setSelected((s) => {
      const n = new Map(s);
      if (n.has(e.id)) n.delete(e.id);
      else n.set(e.id, { status: e.status, label: rowLabel(e) });
      return n;
    });
  };
  const toggleAll = () => {
    setSelected((s) => {
      const n = new Map(s);
      for (const r of selectableRows) {
        if (allSelected) n.delete(r.id);
        else n.set(r.id, { status: r.status, label: rowLabel(r) });
      }
      return n;
    });
  };
  const mixed = (el: HTMLInputElement | null) => {
    // Some but not all rows ticked shows the mixed state.
    if (el) el.indeterminate = someSelected && !allSelected;
  };
  const actions = actionsFor(
    [...selected.values()].map((v) => v.status),
    canEdit,
    isAdmin,
  );

  return (
    <Page>
      <PageHeader
        title={t('expenses_title')}
        actions={
          <>
            <Link to="/expenses/rules" className="text-[14px] text-ink-soft hover:text-ink">
              {t('expenses_tab_rules')}
            </Link>
            {auth.hasRole('editor') ? (
              <Button onClick={() => void navigate({ to: '/expenses/new' })}>
                {t('expenses_new')}
              </Button>
            ) : null}
          </>
        }
      />
      {notice ? <Toast kind="success">{notice}</Toast> : null}
      {selected.size > 0 ? (
        <ExpenseBulkBar
          count={selected.size}
          actions={actions}
          onAction={setBulkAction}
          onClear={() => {
            setSelected(new Map());
          }}
        />
      ) : null}
      <PeriodBar state={period} compare={false} holidays={holidays} />
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('status')}>
        {(['all', 'draft', 'posted'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => {
              setTab(k);
              // A selection from another tab would act on rows no longer in view.
              setSelected(new Map());
            }}
            className={cx(
              'h-9 rounded-md px-3 text-[14px] font-medium',
              tab === k ? 'bg-primary text-on-primary' : 'text-ink-soft hover:bg-sunken',
            )}
          >
            {t(`expenses_tab_${k === 'draft' ? 'drafts' : k}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={buildingId}
          onChange={(e) => {
            setBuildingId(e.target.value);
            setUnitId('');
          }}
          className="w-52"
          aria-label={t('building')}
        >
          <option value="">
            {t('building')}: {t('all')}
          </option>
          {buildings.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {pick(b.nameAr, b.nameEn)}
            </option>
          ))}
        </Select>
        <Select
          value={unitId}
          onChange={(e) => {
            setUnitId(e.target.value);
          }}
          className="w-36"
          aria-label={t('expense_filter_unit')}
          disabled={!buildingId}
        >
          <option value="">
            {t('unit')}: {t('all')}
          </option>
          {building.data?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.unitNo}
            </option>
          ))}
        </Select>
        <Select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
          }}
          className="w-56"
          aria-label={t('expense_category')}
        >
          <option value="">
            {t('expense_category')}: {t('all')}
          </option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {pick(c.nameAr, c.nameEn)}
            </option>
          ))}
        </Select>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ExpenseKind | '');
          }}
          className="w-36"
          aria-label={t('expense_kind')}
        >
          <option value="">
            {t('expense_kind')}: {t('all')}
          </option>
          {EXPENSE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`expense_kind_${k}`)}
            </option>
          ))}
        </Select>
        {tab === 'all' ? (
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ExpenseStatus | '');
            }}
            className="w-36"
            aria-label={t('status')}
          >
            <option value="">
              {t('status')}: {t('all')}
            </option>
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`expense_status_${s}`)}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          value={vendorId}
          onChange={(e) => {
            setVendorId(e.target.value);
          }}
          className="w-52"
          aria-label={t('expense_vendor')}
        >
          <option value="">
            {t('expense_vendor')}: {t('all')}
          </option>
          {vendors.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder={t('expense_search')}
          aria-label={t('search')}
          className="w-64"
        />
        <AwaitingApprovalToggle on={awaiting} onToggle={toggleAwaiting} />
      </div>

      {totals ? (
        <p className="text-[15px]">
          <span className="font-medium">
            {t('expense_totals', { n: totals.count, total: money(totals.totalFils) })}
          </span>
          <span className="ms-3 text-[13px] text-ink-soft">
            {t('expense_totals_split', {
              fixed: num(totals.fixedFils),
              variable: num(totals.variableFils),
              vat: num(totals.vatFils),
            })}
          </span>
        </p>
      ) : null}

      {q.isPending ? (
        <SkeletonRows cols={6} rows={8} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('expenses_empty')} />
      ) : (
        <Card className="overflow-hidden">
          {canEdit && selectableRows.length > 0 ? (
            // Below 768 px the table header is hidden (rows become cards), so its checkbox is too.
            <label className="flex min-h-11 items-center gap-3 border-b border-line px-4 text-[15px] md:hidden">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={allSelected}
                ref={mixed}
                onChange={toggleAll}
              />
              {tb('expbulk_selectAll')}
            </label>
          ) : null}
          <div className="max-h-[70vh] overflow-auto">
            <ResponsiveTable className="w-full min-w-[900px] text-[15px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  {canEdit ? (
                    <th className="w-12 px-3 py-2">
                      {selectableRows.length > 0 ? (
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={allSelected}
                          ref={mixed}
                          onChange={toggleAll}
                          aria-label={tb('expbulk_selectAll')}
                        />
                      ) : null}
                    </th>
                  ) : null}
                  <th className="px-4 py-2 text-start font-medium">{t('expense_invoiceDate')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('expense_category')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('expense_reason')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('building')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('expense_vendor')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('expense_invoiceNo')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('expense_total')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="row-line hover:bg-sunken last:border-b-0">
                    {canEdit ? (
                      <td className="px-3 py-3">
                        {selectable(e) ? (
                          <input
                            type="checkbox"
                            className="size-5 accent-primary"
                            checked={selected.has(e.id)}
                            onChange={() => {
                              toggle(e);
                            }}
                            aria-label={tb('expbulk_selectRow', { label: rowLabel(e) })}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <Link
                        to="/expenses/$expenseId"
                        params={{ expenseId: e.id }}
                        className="font-medium hover:underline"
                      >
                        <DateText date={e.invoiceDate} />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="me-2">{pick(e.categoryNameAr, e.categoryNameEn)}</span>
                      <KindChip kind={e.kind} />
                    </td>
                    <td className="px-4 py-3" dir="auto">
                      {pick(e.reasonAr, e.reasonEn)}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {pick(e.buildingNameAr, e.buildingNameEn)}
                      {e.unitNo ? ` · ${e.unitNo}` : ''}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{e.vendorName ?? '—'}</td>
                    <td className="px-4 py-3 tnum">{e.invoiceNo ?? '—'}</td>
                    <td className="px-4 py-3 text-end">
                      <Money fils={e.totalFils} strong />
                      {e.vatFils > 0 ? (
                        <span className="block text-[12px] text-ink-faint tnum">
                          {t('expense_vat')}: {num(e.vatFils)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        <ExpenseStatusChip status={e.status} />
                        {e.approvalState === 'pending' ||
                        e.approvalState === 'rejected' ||
                        e.approvalState === 'overridden' ? (
                          <ApprovalStateChip state={e.approvalState} />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
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

      {bulkAction ? (
        <ExpenseBulkDialog
          action={bulkAction}
          ids={[...selected.keys()]}
          labelOf={(id) => selected.get(id)?.label ?? id}
          onClose={() => {
            setBulkAction(null);
          }}
          onDone={(n) => {
            setNotice(tb(`expbulk_done_${bulkAction}`, { n }));
            setBulkAction(null);
            setSelected(new Map());
          }}
          onDeselect={(ids) => {
            setBulkAction(null);
            setSelected((s) => {
              const next = new Map(s);
              for (const id of ids) next.delete(id);
              return next;
            });
          }}
        />
      ) : null}
    </Page>
  );
}
