/** Renewal suggestion for one contract and the "Prepare renewal" action. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Emirate, MarketReference, PlainDate, RenewalCap } from '@vamar/shared';
import { request } from './api';
import { invalidateContract } from './queries';
import type { ContractDetail } from './types';

/** GET /api/staff/contracts/:id/renewal-suggestion (apps/api/src/services/renewals.ts). */
export interface RenewalSuggestion {
  contractId: string;
  today: PlainDate;
  endDate: PlainDate;
  dueInDays: number;
  due: boolean;
  windowDays: number;
  currentRentFils: number;
  unit: {
    id: string;
    unitNo: string;
    type: string;
    bedrooms: number | null;
    sizeSqft: number | null;
  };
  building: { id: string; nameAr: string; nameEn: string; area: string };
  emirate: Emirate | null;
  market: MarketReference & { minComparables: number; startedAfter: PlainDate };
  cap: RenewalCap;
  suggestedRentFils: number;
  renewal: { id: string; status: string } | null;
}

export const renewalKey = (id: string) => ['contract', id, 'renewal-suggestion'] as const;

export function useRenewalSuggestion(id: string, enabled: boolean) {
  return useQuery({
    queryKey: renewalKey(id),
    queryFn: () => request<RenewalSuggestion>(`/api/staff/contracts/${id}/renewal-suggestion`),
    enabled,
    // Comparables change only when a contract is signed; no need to refetch on every focus.
    staleTime: 60_000,
  });
}

/** Creates the renewal draft with the rent staff confirmed (the suggestion pre-fills it). */
export function usePrepareRenewal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (annualRentFils: number) =>
      request<ContractDetail>(`/api/staff/contracts/${id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ annualRentFils }),
      }),
    onSuccess: () => {
      invalidateContract(qc, id);
    },
  });
}
