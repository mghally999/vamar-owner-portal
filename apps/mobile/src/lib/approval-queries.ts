/**
 * Owner approval of large repairs: the owner's own requests and the answer. Kept apart from
 * queries.ts so the feature stays in one place.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RepairApprovalStatus } from '@vamar/shared';
import { qs, request } from './api';
import type { ApprovalAnswer, ApprovalDetail, ApprovalItem } from './approval-types';

export interface ApprovalFilters {
  status?: RepairApprovalStatus | undefined;
  workOrderId?: string | undefined;
}

export function useApprovals(filters: ApprovalFilters = {}) {
  return useQuery({
    queryKey: ['approvals', filters],
    queryFn: () =>
      request<{ items: ApprovalItem[] }>(`/api/owner/approvals${qs({ ...filters })}`).then(
        (r) => r.items,
      ),
  });
}

export function useApproval(id: string) {
  return useQuery({
    queryKey: ['approval', id],
    queryFn: () => request<ApprovalDetail>(`/api/owner/approvals/${id}`),
  });
}

export function useAnswerApproval(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalAnswer) =>
      request<ApprovalDetail>(`/api/owner/approvals/${id}`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (detail) => {
      // The reply is the answered request: show it at once, then refresh the lists around it.
      qc.setQueryData(['approval', id], detail);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
      if (detail.workOrderId)
        void qc.invalidateQueries({ queryKey: ['work-order', detail.workOrderId] });
    },
  });
}
