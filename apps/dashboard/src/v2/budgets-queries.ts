/** Building budgets: the report (GET /api/staff/budgets) and the admin's writes. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BudgetLine, CreateBudgetInput, PlainDate } from '@vamar/shared';
import { qs, request } from '@/lib/api';
import { keys } from '@/lib/queries';

/** One line as the API sends it (apps/api/src/services/budgets.ts). */
export interface BudgetLineRow extends BudgetLine {
  nameAr: string | null;
  nameEn: string | null;
}

export interface BuildingBudget {
  buildingId: string;
  nameAr: string;
  nameEn: string;
  lines: BudgetLineRow[];
}

export interface BudgetReport {
  year: number;
  today: PlainDate;
  buildings: BuildingBudget[];
}

export const budgetKeys = {
  all: ['budgets'] as const,
  report: (year: number, buildingId?: string) => ['budgets', year, buildingId ?? 'all'] as const,
};

export function useBudgetReport(year: number, buildingId?: string) {
  return useQuery({
    queryKey: budgetKeys.report(year, buildingId),
    queryFn: () => request<BudgetReport>(`/api/staff/budgets${qs({ year, buildingId })}`),
    staleTime: 30_000,
  });
}

/** Every budget figure and the Today panel's count move together. */
function useInvalidateBudgets() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: budgetKeys.all });
    void qc.invalidateQueries({ queryKey: keys.overview });
  };
}

export function useCreateBudget() {
  const invalidate = useInvalidateBudgets();
  return useMutation({
    mutationFn: (input: CreateBudgetInput) =>
      request<{ id: string }>('/api/staff/budgets', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateBudget() {
  const invalidate = useInvalidateBudgets();
  return useMutation({
    mutationFn: ({ id, amountFils }: { id: string; amountFils: number }) =>
      request<{ id: string }>(`/api/staff/budgets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ amountFils }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidateBudgets();
  return useMutation({
    mutationFn: (id: string) => request(`/api/staff/budgets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
