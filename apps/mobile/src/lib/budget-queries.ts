/** The budgets of the owner's buildings for this year (GET /api/owner/budgets). */
import { useQuery } from '@tanstack/react-query';
import type { BudgetLine, PlainDate } from '@vamar/shared';
import { request } from './api';

export interface OwnerBudgetLine extends BudgetLine {
  /** The category's names; null on the building's total line. */
  nameAr: string | null;
  nameEn: string | null;
}

export interface OwnerBuildingBudget {
  buildingId: string;
  nameAr: string;
  nameEn: string;
  lines: OwnerBudgetLine[];
}

export interface OwnerBudgets {
  year: number;
  today: PlainDate;
  buildings: OwnerBuildingBudget[];
}

export function useOwnerBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: () => request<OwnerBudgets>('/api/owner/budgets'),
    // Budgets move only when an expense is posted; no need to refetch on every focus.
    staleTime: 5 * 60_000,
  });
}
