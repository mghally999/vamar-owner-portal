/**
 * TanStack Query hooks over the v2 staff API: expenses and their categories, vendors and rules,
 * work orders, the report summary, holidays, settings and search. Keys: ['expenses', filters],
 * ['expense', id], ['work-orders', filters], ['work-order', id], ['report', filters], ...
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { qs, request } from './api';
import { keys } from './queries';
import type { Attachment, Page } from './types';
import type {
  AllocationPreviewRow,
  AppSettings,
  ExpenseCategory,
  ExpenseDetail,
  ExpenseRow,
  ExpenseTotals,
  ExpenseWarnings,
  Holiday,
  RecurringRule,
  ReportSummary,
  SearchHit,
  Vendor,
  WorkOrderDetail,
  WorkOrderRow,
} from './types-v2';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export const v2keys = {
  categories: ['expense-categories'] as const,
  vendors: (search?: string) => ['vendors', search ?? ''] as const,
  expenses: (f: QueryParams) => ['expenses', f] as const,
  expense: (id: string) => ['expense', id] as const,
  rules: (f: QueryParams) => ['recurring-rules', f] as const,
  workOrders: (f: QueryParams) => ['work-orders', f] as const,
  workOrder: (id: string) => ['work-order', id] as const,
  report: (f: QueryParams) => ['report', f] as const,
  holidays: (year?: number) => ['holidays', year ?? 'all'] as const,
  settings: ['settings'] as const,
  search: (q: string) => ['search', q] as const,
};

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: [...v2keys.categories, includeInactive],
    queryFn: () =>
      request<{ items: ExpenseCategory[] }>(
        `/api/staff/expense-categories${qs({ includeInactive: includeInactive ? '1' : undefined })}`,
      ).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

export function useVendors(search?: string) {
  return useQuery({
    queryKey: v2keys.vendors(search),
    queryFn: () =>
      request<{ items: Vendor[] }>(`/api/staff/vendors${qs({ search })}`).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      phone?: string | null;
      email?: string | null;
      trn?: string | null;
    }) => request<Vendor>('/api/staff/vendors', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
}

export function useExpenses(filters: QueryParams) {
  return useInfiniteQuery({
    queryKey: v2keys.expenses(filters),
    queryFn: ({ pageParam }) =>
      request<Page<ExpenseRow> & { totals: ExpenseTotals }>(
        `/api/staff/expenses${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useExpense(id: string) {
  return useQuery({
    queryKey: v2keys.expense(id),
    queryFn: () => request<ExpenseDetail>(`/api/staff/expenses/${id}`),
    enabled: id !== '',
  });
}

function invalidateExpenses(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: ['expenses'] });
  void qc.invalidateQueries({ queryKey: ['report'] });
  void qc.invalidateQueries({ queryKey: ['work-orders'] });
  void qc.invalidateQueries({ queryKey: ['work-order'] });
  if (id) void qc.invalidateQueries({ queryKey: v2keys.expense(id) });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: object) =>
      request<ExpenseRow & { warnings: ExpenseWarnings }>('/api/staff/expenses', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateExpenses(qc);
    },
  });
}

export function useUpdateExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: object) =>
      request<ExpenseRow>(`/api/staff/expenses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      invalidateExpenses(qc, id);
    },
  });
}

export function useDeleteExpenseDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/api/staff/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      invalidateExpenses(qc, id);
    },
  });
}

export function usePostExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ expense: ExpenseRow; allocations: unknown[]; large: boolean }>(
        `/api/staff/expenses/${id}/post`,
        { method: 'POST' },
      ),
    onSuccess: (_d, id) => {
      invalidateExpenses(qc, id);
    },
  });
}

export function useVoidExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      reason,
      correction,
    }: {
      id: string;
      reason: string;
      correction?: object | undefined;
    }) =>
      request<{ voided: ExpenseRow; correction: { expense: ExpenseRow } | null }>(
        `/api/staff/expenses/${id}/void`,
        { method: 'POST', body: JSON.stringify({ reason, correction }) },
      ),
    onSuccess: (_d, { id }) => {
      invalidateExpenses(qc, id);
    },
  });
}

export function usePreviewAllocation() {
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      request<{ method: string; items: AllocationPreviewRow[] }>(
        '/api/staff/expenses/preview-allocation',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  });
}

export function useExpenseWarnings() {
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      request<ExpenseWarnings>('/api/staff/expenses/warnings', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useRules(filters: QueryParams = {}) {
  return useQuery({
    queryKey: v2keys.rules(filters),
    queryFn: () =>
      request<{ items: RecurringRule[] }>(`/api/staff/recurring-rules${qs(filters)}`).then(
        (r) => r.items,
      ),
  });
}

export function useSaveRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string | undefined; input: Record<string, unknown> }) =>
      id
        ? request<RecurringRule>(`/api/staff/recurring-rules/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(input),
          })
        : request<RecurringRule>('/api/staff/recurring-rules', {
            method: 'POST',
            body: JSON.stringify(input),
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring-rules'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

export function useWorkOrders(filters: QueryParams) {
  return useInfiniteQuery({
    queryKey: v2keys.workOrders(filters),
    queryFn: ({ pageParam }) =>
      request<Page<WorkOrderRow>>(
        `/api/staff/work-orders${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: v2keys.workOrder(id),
    queryFn: () => request<WorkOrderDetail>(`/api/staff/work-orders/${id}`),
    enabled: id !== '',
  });
}

export function useSaveWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string | undefined; input: Record<string, unknown> }) =>
      id
        ? request<WorkOrderRow>(`/api/staff/work-orders/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(input),
          })
        : request<WorkOrderRow>('/api/staff/work-orders', {
            method: 'POST',
            body: JSON.stringify(input),
          }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      void qc.invalidateQueries({ queryKey: v2keys.workOrder(row.id) });
      void qc.invalidateQueries({ queryKey: ['expense'] });
    },
  });
}

/**
 * Admin: let a work order start (or an expense be posted) over pending or rejected owner answers.
 * The reason is required by the API and kept in the audit log.
 */
export function useOverrideApprovals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      id,
      reason,
    }: {
      kind: 'work_order' | 'expense';
      id: string;
      reason: string;
    }) =>
      request<{ items: unknown[] }>(
        `/api/staff/${kind === 'work_order' ? 'work-orders' : 'expenses'}/${id}/approvals/override`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    onSuccess: () => {
      // An expense can show its job's answers and the job its expense: refresh both sides.
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      void qc.invalidateQueries({ queryKey: ['work-order'] });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense'] });
    },
  });
}

export function useReportSummary(filters: QueryParams, enabled = true) {
  return useQuery({
    queryKey: v2keys.report(filters),
    queryFn: () => request<ReportSummary>(`/api/staff/reports/summary${qs(filters)}`),
    staleTime: 15_000,
    enabled,
  });
}

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: v2keys.holidays(year),
    queryFn: () =>
      request<{ items: Holiday[] }>(`/api/staff/holidays${qs({ year })}`).then((r) => r.items),
    staleTime: 60 * 60_000,
  });
}

/** The holiday dates as a set, for the date pickers' weekend and holiday warnings. */
export function useHolidaySet(): ReadonlySet<string> | undefined {
  const q = useHolidays();
  return q.data ? new Set(q.data.map((h) => h.date)) : undefined;
}

export function useSettings() {
  return useQuery({
    queryKey: v2keys.settings,
    queryFn: () => request<AppSettings>('/api/staff/settings'),
    staleTime: 5 * 60_000,
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: v2keys.search(q),
    queryFn: () =>
      request<{ items: SearchHit[] }>(`/api/staff/search${qs({ q })}`).then((r) => r.items),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });
}

export type FileEntityType = 'dispute' | 'contract' | 'unit' | 'expense' | 'work_order';

/** Upload a file to any entity (invoices on expenses, photos on work orders, court papers on disputes). */
export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      file,
    }: {
      entityType: FileEntityType;
      entityId: string;
      file: File;
    }) => {
      const form = new FormData();
      form.set('entityType', entityType);
      form.set('entityId', entityId);
      form.set('file', file);
      return request<Attachment>('/api/staff/attachments', { method: 'POST', body: form });
    },
    onSuccess: (_d, { entityType, entityId }) => {
      if (entityType === 'expense')
        void qc.invalidateQueries({ queryKey: v2keys.expense(entityId) });
      if (entityType === 'work_order')
        void qc.invalidateQueries({ queryKey: v2keys.workOrder(entityId) });
      if (entityType === 'dispute') void qc.invalidateQueries({ queryKey: keys.dispute(entityId) });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/api/staff/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expense'] });
      void qc.invalidateQueries({ queryKey: ['work-order'] });
    },
  });
}
