import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChequeStatus } from '@vamar/shared';
import { qs, request } from './api';
import type {
  BuildingItem,
  ChequeDetail,
  ChequeItem,
  DeviceItem,
  DisputeDetail,
  DisputeItem,
  Home,
  OwnerProfile,
  Page,
  UnitDetail,
  UnitItem,
} from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => request<OwnerProfile>('/api/owner/me') });
}

export function useHome(month: string) {
  return useQuery({
    queryKey: ['home', month],
    queryFn: () => request<Home>(`/api/owner/home${qs({ month })}`),
    staleTime: 60_000,
  });
}

export interface ChequeFilters {
  month?: string | undefined;
  buildingId?: string | undefined;
  unitId?: string | undefined;
  status?: ChequeStatus | undefined;
}

export function useCheques(filters: ChequeFilters) {
  return useInfiniteQuery({
    queryKey: ['cheques', filters],
    queryFn: ({ pageParam }) =>
      request<Page<ChequeItem>>(
        `/api/owner/cheques${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCheque(id: string) {
  return useQuery({
    queryKey: ['cheque', id],
    queryFn: () => request<ChequeDetail>(`/api/owner/cheques/${id}`),
  });
}

export function useBuildings() {
  return useQuery({
    queryKey: ['buildings'],
    queryFn: () => request<{ items: BuildingItem[] }>('/api/owner/buildings').then((r) => r.items),
  });
}

export function useUnits(buildingId?: string) {
  return useQuery({
    queryKey: ['units', buildingId ?? ''],
    queryFn: () =>
      request<{ items: UnitItem[]; truncated?: boolean }>(
        `/api/owner/units${qs({ buildingId })}`,
      ).then((r) => ({ items: r.items, truncated: r.truncated === true })),
  });
}

export function useUnit(id: string) {
  return useQuery({
    queryKey: ['unit', id],
    queryFn: () => request<UnitDetail>(`/api/owner/units/${id}`),
  });
}

export function useDisputes() {
  return useInfiniteQuery({
    queryKey: ['disputes'],
    queryFn: ({ pageParam }) =>
      request<Page<DisputeItem>>(`/api/owner/disputes${qs({ cursor: pageParam, limit: 50 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useDispute(id: string) {
  return useQuery({
    queryKey: ['dispute', id],
    queryFn: () => request<DisputeDetail>(`/api/owner/disputes/${id}`),
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: () => request<{ items: DeviceItem[] }>('/api/auth/owner/devices').then((r) => r.items),
  });
}

export function useRevokeOtherDevices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request('/api/auth/owner/devices/revoke-others', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['devices'] }),
  });
}

export function useRequestDeletion() {
  return useMutation({
    mutationFn: (reason: string) =>
      request('/api/owner/account/delete-request', {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
  });
}

export function useSetLang() {
  return useMutation({
    mutationFn: (preferredLang: 'ar' | 'en') =>
      request('/api/owner/me', { method: 'PATCH', body: JSON.stringify({ preferredLang }) }),
  });
}
