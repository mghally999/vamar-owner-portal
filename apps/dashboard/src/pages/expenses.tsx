/**
 * Expenses list: period bar, tabs (all, drafts queue, posted), filters (building, unit, category,
 * kind, status, vendor, search), the totals of the filtered set, and a link to the recurring rules.
 * Rows staff can act on have a checkbox; the bulk bar posts or deletes drafts and shows or hides
 * posted expenses from the owners.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
  type BulkExpenseAction,
  type ExpenseKind,
  type ExpenseStatus,
} from '@vamar/shared';
import { useAuth } from '@/lib/auth';
import { useExpenseBulkI18n } from '@/lib/expense-bulk-messages';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { usePeriodSearch } from '@/lib/period-search';
import { useUrlFilters, useUrlSearchText } from '@/lib/url-filters';
import { useBuilding, useBuildings } from '@/lib/queries';
import { useCategories, useExpenses, useHolidaySet, useVendors } from '@/lib/queries-v2';
import { PeriodBar } from '@/ui/period-bar';
import {
  Button,
  Card,
  DateText,
  chipClass,
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
import { LoadMore } from '@/ui/load-more';
import { ResponsiveTable } from '@/ui/responsive-table';
import { SortHeader, useListSort } from '@/ui/sort-header';
import { MobileSelectAll, SelectAllBox } from '@/ui/select-all';
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
    <span className={cx(chipClass, expenseChip[status])}>{t(`expense_status_${status}`)}</span>
  );
}

export function KindChip({ kind }: { kind: ExpenseKind }) {
  const { t } = useI18n();
  return <span className={cx(chipClass, 'bg-chip text-on-chip')}>{t(`expense_kind_${kind}`)}</span>;
}

/**
 * The list's filters, kept in the URL. `status` is the tab (`?status=draft` is the drafts queue
 * the Today panel links to); `filterStatus` is the status select of the "All" tab.
 */
const FILTERS = {
  status: '',
  buildingId: '',
  unitId: '',
  categoryId: '',
  kind: '',
  filterStatus: '',
  vendorId: '',
  search: '',
};

/**
 * Columns left out between 768 and 1024 px, where the table is too wide for a tablet and its total
 * and status columns were cut off at the card edge. Both are on the expense page and the search box
 * finds them; phones (cards) and desktops keep every column.
 */
const TABLET_HIDDEN = 'md:max-lg:hidden';

/** Columns the API sorts this list by (its allow-list). */
const EXPENSES_SORT = ['invoiceDate', 'category', 'building', 'vendor', 'total', 'status'] as const;

export function ExpensesPage() {
  const { t, pick, money, num, date } = useI18n();
  const { tb } = useExpenseBulkI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const period = usePeriodSearch('this_month');
  const holidays = useHolidaySet();
  const [url, setFilters] = useUrlFilters(FILTERS);
  const tab = url.status === 'draft' || url.status === 'posted' ? url.status : 'all';
  const { buildingId, unitId, categoryId, vendorId } = url;
  const kind = (EXPENSE_KINDS as readonly string[]).includes(url.kind)
    ? (url.kind as ExpenseKind)
    : '';
  const status = (EXPENSE_STATUSES as readonly string[]).includes(url.filterStatus)
    ? (url.filterStatus as ExpenseStatus)
    : '';
  const searchText = url.search;
  const [text, setText] = useUrlSearchText(searchText, (v) => {
    setFilters({ search: v });
  });
  const buildings = useBuildings();
  const building = useBuilding(buildingId);
  const categories = useCategories();
  const vendors = useVendors();
  const [awaiting, toggleAwaiting] = useAwaitingApprovalFilter();
  // Kept with each id so the actions and the refusal names do not depend on the rows in view.
  const [selected, setSelected] = useState<Map<string, { status: ExpenseStatus; label: string }>>(
    new Map(),
  );
  // A selection belongs to one list: another tab, filter or period starts a new one, so the bulk
  // bar never acts on expenses that are no longer shown.
  const [bulkAction, setBulkAction] = useState<BulkExpenseAction | null>(null);
  const listKey = JSON.stringify([url, period.query, awaiting]);
  useEffect(() => {
    setSelected(new Map());
    // An open bulk dialog acts on the selection just cleared: close it rather than send nothing.
    setBulkAction(null);
  }, [listKey]);
  const [notice, setNotice] = useState<string | null>(null);

  const sorting = useListSort(EXPENSES_SORT);
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
    ...sorting.params,
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
              setFilters({ status: k === 'all' ? '' : k });
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
            setFilters({ buildingId: e.target.value, unitId: '' });
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
            setFilters({ unitId: e.target.value });
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
            setFilters({ categoryId: e.target.value });
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
            setFilters({ kind: e.target.value });
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
              setFilters({ filterStatus: e.target.value });
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
            setFilters({ vendorId: e.target.value });
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
            <MobileSelectAll
              all={allSelected}
              some={someSelected}
              onToggle={toggleAll}
              label={tb('expbulk_selectAll')}
            />
          ) : null}
          <div className="max-h-[70vh] overflow-auto">
            <ResponsiveTable className="w-full text-[15px] lg:min-w-[900px]">
              <thead>
                <tr className="row-line text-[13px] text-ink-soft">
                  {canEdit ? (
                    <th className="w-12 px-3 py-2">
                      {selectableRows.length > 0 ? (
                        <SelectAllBox
                          all={allSelected}
                          some={someSelected}
                          onToggle={toggleAll}
                          label={tb('expbulk_selectAll')}
                        />
                      ) : null}
                    </th>
                  ) : null}
                  <SortHeader
                    label={t('expense_invoiceDate')}
                    column="invoiceDate"
                    state={sorting}
                  />
                  <SortHeader label={t('expense_category')} column="category" state={sorting} />
                  <th className="px-4 py-2 text-start font-medium">{t('expense_reason')}</th>
                  <SortHeader label={t('building')} column="building" state={sorting} />
                  <SortHeader
                    label={t('expense_vendor')}
                    column="vendor"
                    state={sorting}
                    className={TABLET_HIDDEN}
                  />
                  <th className={cx('px-4 py-2 text-start font-medium', TABLET_HIDDEN)}>
                    {t('expense_invoiceNo')}
                  </th>
                  <SortHeader
                    label={t('expense_total')}
                    column="total"
                    state={sorting}
                    align="end"
                  />
                  <SortHeader label={t('status')} column="status" state={sorting} />
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
                    <td className={cx('px-4 py-3 text-ink-soft', TABLET_HIDDEN)}>
                      {e.vendorName ?? '—'}
                    </td>
                    <td className={cx('px-4 py-3 tnum', TABLET_HIDDEN)}>{e.invoiceNo ?? '—'}</td>
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
          <LoadMore query={q} />
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
