/** Bank statement matching: saved column mappings and the cheques a statement can settle. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BankCsvMapping, CandidateCheque } from '@vamar/shared';
import { qs, request } from './api';

const MAPPINGS_PATH = '/api/staff/settings/bank-csv-mappings';

export interface BankCandidate extends CandidateCheque {
  bankName: string | null;
  unitNo: string;
  buildingNameAr: string;
  buildingNameEn: string;
  tenantName: string;
}

export function useBankMappings() {
  return useQuery({
    queryKey: ['bank-mappings'],
    queryFn: async () => (await request<{ items: BankCsvMapping[] }>(MAPPINGS_PATH)).items,
  });
}

export function useSaveBankMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mapping: BankCsvMapping) =>
      (
        await request<{ items: BankCsvMapping[] }>(MAPPINGS_PATH, {
          method: 'PUT',
          body: JSON.stringify(mapping),
        })
      ).items,
    onSuccess: (items) => {
      qc.setQueryData(['bank-mappings'], items);
    },
  });
}

export function useDeleteBankMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bank: string) =>
      (
        await request<{ items: BankCsvMapping[] }>(`${MAPPINGS_PATH}${qs({ bank })}`, {
          method: 'DELETE',
        })
      ).items,
    onSuccess: (items) => {
      qc.setQueryData(['bank-mappings'], items);
    },
  });
}

export function useBankCandidates(window: { from: string; to: string } | null) {
  return useQuery({
    queryKey: ['bank-candidates', window],
    enabled: window !== null,
    queryFn: async () =>
      (
        await request<{ items: BankCandidate[] }>(
          `/api/staff/cheques/bank-candidates${qs({ from: window?.from, to: window?.to })}`,
        )
      ).items,
  });
}
