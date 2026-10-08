/**
 * TanStack Query hooks over the staff API. Keys are structured so invalidation is predictable:
 * ['owners'], ['owner', id], ['buildings'], ['building', id], ['contracts'], ['contract', id],
 * ['cheques', filters], ['cheque', id], ['disputes'], ['dispute', id], ['overview'], ...
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  ChequeStatus,
  ContractStatus,
  CreateContractInput,
  CreateOwnerInput,
  DisputeStatus,
} from '@vamar/shared';
import { qs, request } from './api';
import type {
  AuditRow,
  BuildingDetail,
  BuildingRow,
  ChequeDetail,
  ChequeRow,
  ContractDetail,
  ContractRow,
  DisputeDetail,
  DisputeRow,
  OwnerDetail,
  OwnerRow,
  Overview,
  Page,
  StaffRow,
  Tenant,
} from './types';

export const keys = {
  overview: ['overview'] as const,
  owners: (f: Record<string, string | undefined>) => ['owners', f] as const,
  owner: (id: string) => ['owner', id] as const,
  buildings: ['buildings'] as const,
  building: (id: string) => ['building', id] as const,
  tenants: (search?: string) => ['tenants', search ?? ''] as const,
  contracts: (f: Record<string, string | number | undefined>) => ['contracts', f] as const,
  contract: (id: string) => ['contract', id] as const,
  cheques: (f: Record<string, string | undefined>) => ['cheques', f] as const,
  cheque: (id: string) => ['cheque', id] as const,
  disputes: (f: Record<string, string | undefined>) => ['disputes', f] as const,
  dispute: (id: string) => ['dispute', id] as const,
  staff: ['staff'] as const,
  audit: (f: Record<string, string | undefined>) => ['audit', f] as const,
};

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: () => request<Overview>('/api/staff/overview'),
    staleTime: 15_000,
  });
}

export function useOwners(filters: { search?: string | undefined; status?: string | undefined }) {
  return useInfiniteQuery({
    queryKey: keys.owners(filters),
    queryFn: ({ pageParam }) =>
      request<Page<OwnerRow>>(
        `/api/staff/owners${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOwner(id: string) {
  return useQuery({
    queryKey: keys.owner(id),
    queryFn: () => request<OwnerDetail>(`/api/staff/owners/${id}`),
  });
}

export function prefetchOwner(qc: QueryClient, id: string) {
  void qc
    .query({
      queryKey: keys.owner(id),
      queryFn: () => request<OwnerDetail>(`/api/staff/owners/${id}`),
      staleTime: 30_000,
    })
    .catch(() => undefined);
}

export function useCreateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOwnerInput) =>
      request<OwnerRow>('/api/staff/owners', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['owners'] }),
  });
}

export function useUpdateOwner(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CreateOwnerInput>) =>
      request<OwnerRow>(`/api/staff/owners/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.owner(id) });
      void qc.invalidateQueries({ queryKey: ['owners'] });
    },
  });
}

export function useSetOwnerStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: 'active' | 'disabled') =>
      request<OwnerRow>(`/api/staff/owners/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.owner(id) });
      void qc.invalidateQueries({ queryKey: ['owners'] });
    },
  });
}

export function useBuildings() {
  return useQuery({
    queryKey: keys.buildings,
    queryFn: () => request<{ items: BuildingRow[] }>('/api/staff/buildings').then((r) => r.items),
  });
}

export function useBuilding(id: string) {
  return useQuery({
    queryKey: keys.building(id),
    queryFn: () => request<BuildingDetail>(`/api/staff/buildings/${id}`),
  });
}

export function prefetchBuilding(qc: QueryClient, id: string) {
  void qc
    .query({
      queryKey: keys.building(id),
      queryFn: () => request<BuildingDetail>(`/api/staff/buildings/${id}`),
      staleTime: 30_000,
    })
    .catch(() => undefined);
}

export function useCreateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      nameAr: string;
      nameEn: string;
      area: string;
      address?: string;
      notes?: string;
    }) =>
      request<BuildingRow>('/api/staff/buildings', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.buildings }),
  });
}

export function useCreateUnit(buildingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      unitNo: string;
      type: string;
      bedrooms?: number | null;
      sizeSqft?: number | null;
    }) =>
      request(`/api/staff/units`, {
        method: 'POST',
        body: JSON.stringify({ ...input, buildingId }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.building(buildingId) });
      void qc.invalidateQueries({ queryKey: keys.buildings });
    },
  });
}

export function useSetUnitOwners(buildingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      unitId: string;
      fromDate: string;
      owners: { ownerId: string; shareBp: number }[];
    }) =>
      request(`/api/staff/units/${input.unitId}/owners`, {
        method: 'PUT',
        body: JSON.stringify({ fromDate: input.fromDate, owners: input.owners }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.building(buildingId) });
      void qc.invalidateQueries({ queryKey: ['owners'] });
      void qc.invalidateQueries({ queryKey: ['owner'] });
    },
  });
}

export function useTenants(search?: string) {
  return useQuery({
    queryKey: keys.tenants(search),
    queryFn: () =>
      request<{ items: Tenant[] }>(`/api/staff/tenants${qs({ search })}`).then((r) => r.items),
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      phone?: string | null;
      email?: string | null;
      company?: string | null;
    }) => request<Tenant>('/api/staff/tenants', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
}

export function useContracts(filters: {
  status?: ContractStatus | undefined;
  buildingId?: string | undefined;
  endingWithinDays?: number | undefined;
}) {
  return useInfiniteQuery({
    queryKey: keys.contracts(filters),
    queryFn: ({ pageParam }) =>
      request<Page<ContractRow>>(
        `/api/staff/contracts${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: keys.contract(id),
    queryFn: () => request<ContractDetail>(`/api/staff/contracts/${id}`),
  });
}

export function prefetchContract(qc: QueryClient, id: string) {
  void qc
    .query({
      queryKey: keys.contract(id),
      queryFn: () => request<ContractDetail>(`/api/staff/contracts/${id}`),
      staleTime: 30_000,
    })
    .catch(() => undefined);
}

export function invalidateContract(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: keys.contract(id) });
  void qc.invalidateQueries({ queryKey: ['contracts'] });
  void qc.invalidateQueries({ queryKey: ['cheques'] });
  void qc.invalidateQueries({ queryKey: ['building'] });
  void qc.invalidateQueries({ queryKey: keys.overview });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContractInput) =>
      request<ContractDetail>('/api/staff/contracts', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contracts'] }),
  });
}

export function useUpdateContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      request(`/api/staff/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      invalidateContract(qc, id);
    },
  });
}

export function useActivateContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (totalMismatchReason?: string) =>
      request(`/api/staff/contracts/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify(totalMismatchReason ? { totalMismatchReason } : {}),
      }),
    onSuccess: () => {
      invalidateContract(qc, id);
    },
  });
}

export function useRenewContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<ContractDetail>(`/api/staff/contracts/${id}/renew`, { method: 'POST' }),
    onSuccess: (_d, id) => {
      invalidateContract(qc, id);
    },
  });
}

export function useTerminateContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      request(`/api/staff/contracts/${id}/terminate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      invalidateContract(qc, id);
    },
  });
}

export interface ChequeFilters {
  month?: string | undefined;
  buildingId?: string | undefined;
  ownerId?: string | undefined;
  status?: string | undefined;
  contractId?: string | undefined;
}

export function useCheques(filters: ChequeFilters) {
  return useInfiniteQuery({
    queryKey: keys.cheques(filters as Record<string, string | undefined>),
    queryFn: ({ pageParam }) =>
      request<Page<ChequeRow>>(
        `/api/staff/cheques${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCheque(id: string) {
  return useQuery({
    queryKey: keys.cheque(id),
    queryFn: () => request<ChequeDetail>(`/api/staff/cheques/${id}`),
  });
}

export function prefetchCheque(qc: QueryClient, id: string) {
  void qc
    .query({
      queryKey: keys.cheque(id),
      queryFn: () => request<ChequeDetail>(`/api/staff/cheques/${id}`),
      staleTime: 30_000,
    })
    .catch(() => undefined);
}

export interface StatusChangeInput {
  to: ChequeStatus;
  note?: string | undefined;
  bounceReason?: string | undefined;
  overrideReason?: string | undefined;
  replacement?:
    { dueDate: string; amountFils: number; chequeNo: string; bankName: string } | undefined;
}

function invalidateCheque(qc: QueryClient, id: string, contractId?: string) {
  void qc.invalidateQueries({ queryKey: keys.cheque(id) });
  void qc.invalidateQueries({ queryKey: ['cheques'] });
  void qc.invalidateQueries({ queryKey: keys.overview });
  if (contractId) void qc.invalidateQueries({ queryKey: keys.contract(contractId) });
}

/** Optimistic: the row's status flips immediately in every cached cheque list; rolled back on error. */
export function useChangeChequeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: StatusChangeInput }) =>
      request<{
        cheque: { status: ChequeStatus; contractId: string };
        replacement: { id: string } | null;
      }>(`/api/staff/cheques/${id}/status`, { method: 'POST', body: JSON.stringify(input) }),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ['cheques'] });
      const snapshots = qc.getQueriesData<{ pages: Page<ChequeRow>[] }>({ queryKey: ['cheques'] });
      qc.setQueriesData<{ pages: Page<ChequeRow>[]; pageParams: unknown[] }>(
        { queryKey: ['cheques'] },
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((p) => ({
                  ...p,
                  items: p.items.map((c) => (c.id === id ? { ...c, status: input.to } : c)),
                })),
              }
            : old,
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: (data, _e, { id }) => {
      invalidateCheque(qc, id, data?.cheque.contractId);
    },
  });
}

export function useBulkChequeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { chequeIds: string[]; to: ChequeStatus; note?: string }) =>
      request<{ ok: string[]; failed: { id: string; reason: string }[] }>(
        '/api/staff/cheques/bulk-status',
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cheques'] });
      void qc.invalidateQueries({ queryKey: ['contract'] });
      void qc.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

export function useUpdateChequeRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      request<{ contractId: string }>(`/api/staff/cheques/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data, { id }) => {
      invalidateCheque(qc, id, data.contractId);
    },
  });
}

export function useUploadChequeImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.set('file', file);
      return request(`/api/staff/cheques/${id}/image`, { method: 'POST', body: form });
    },
    onSuccess: (_d, { id }) => {
      invalidateCheque(qc, id);
    },
  });
}

export function useDisputes(filters: {
  status?: DisputeStatus | undefined;
  buildingId?: string | undefined;
}) {
  return useQuery({
    queryKey: keys.disputes(filters),
    queryFn: () =>
      request<{ items: DisputeRow[] }>(`/api/staff/disputes${qs(filters)}`).then((r) => r.items),
  });
}

export function useDispute(id: string) {
  return useQuery({
    queryKey: keys.dispute(id),
    queryFn: () => request<DisputeDetail>(`/api/staff/disputes/${id}`),
  });
}

export function prefetchDispute(qc: QueryClient, id: string) {
  void qc
    .query({
      queryKey: keys.dispute(id),
      queryFn: () => request<DisputeDetail>(`/api/staff/disputes/${id}`),
      staleTime: 30_000,
    })
    .catch(() => undefined);
}

export function useCreateDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      request<DisputeDetail>('/api/staff/disputes', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['disputes'] }),
  });
}

export function useUpdateDispute(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      request(`/api/staff/disputes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.dispute(id) });
      void qc.invalidateQueries({ queryKey: ['disputes'] });
    },
  });
}

export function useAddDisputeUpdate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { note: string; visibleToOwner: boolean }) =>
      request(`/api/staff/disputes/${id}/updates`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.dispute(id) }),
  });
}

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      file,
    }: {
      entityType: 'dispute' | 'contract' | 'unit';
      entityId: string;
      file: File;
    }) => {
      const form = new FormData();
      form.set('entityType', entityType);
      form.set('entityId', entityId);
      form.set('file', file);
      return request('/api/staff/attachments', { method: 'POST', body: form });
    },
    onSuccess: (_d, { entityType, entityId }) => {
      if (entityType === 'dispute') void qc.invalidateQueries({ queryKey: keys.dispute(entityId) });
    },
  });
}

export function useDeleteAttachment(disputeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/api/staff/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.dispute(disputeId) }),
  });
}

export function useStaff() {
  return useQuery({
    queryKey: keys.staff,
    queryFn: () => request<{ items: StaffRow[] }>('/api/staff/staff').then((r) => r.items),
  });
}

export function useStaffMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: keys.staff });
  return {
    invite: useMutation({
      mutationFn: (input: { email: string; name: string; role: string }) =>
        request('/api/staff/staff', { method: 'POST', body: JSON.stringify(input) }),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
        request(`/api/staff/staff/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      onSuccess: done,
    }),
    resetTotp: useMutation({
      mutationFn: (id: string) => request(`/api/staff/staff/${id}/reset-totp`, { method: 'POST' }),
      onSuccess: done,
    }),
  };
}

export function useAudit(filters: {
  actorId?: string | undefined;
  entityType?: string | undefined;
  action?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  return useInfiniteQuery({
    queryKey: keys.audit(filters),
    queryFn: ({ pageParam }) =>
      request<Page<AuditRow>>(
        `/api/staff/audit${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
