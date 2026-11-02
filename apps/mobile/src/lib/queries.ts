import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChequeStatus, ExpenseKind, TimelineKind, WorkOrderStatus } from '@vamar/shared';
import type { PeriodQuery } from './period';
import { qs, request } from './api';
import type {
  BuildingItem,
  CalendarResponse,
  ExpenseDetail,
  ExpenseItem,
  Summary,
  TimelineEntry,
  WorkOrderDetail,
  WorkOrderItem,
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
  from?: string | undefined;
  to?: string | undefined;
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

// v2 -------------------------------------------------------------------------------------------

/** Everything Home shows for the chosen period, in one request. */
export function useSummary(period: PeriodQuery, options: { buildingId?: string | undefined } = {}) {
  return useQuery({
    queryKey: ['summary', period, options.buildingId ?? ''],
    queryFn: () => request<Summary>(`/api/owner/summary${qs({ ...period, ...options })}`),
    staleTime: 60_000,
  });
}

export type ExpenseFilters = PeriodQuery & {
  buildingId?: string | undefined;
  unitId?: string | undefined;
  categoryId?: string | undefined;
  kind?: ExpenseKind | undefined;
};

export function useExpenses(filters: ExpenseFilters) {
  return useInfiniteQuery({
    queryKey: ['expenses', filters],
    queryFn: ({ pageParam }) =>
      request<Page<ExpenseItem>>(
        `/api/owner/expenses${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useExpense(id: string) {
  return useQuery({
    queryKey: ['expense', id],
    queryFn: () => request<ExpenseDetail>(`/api/owner/expenses/${id}`),
  });
}

export function useWorkOrders(
  filters: { unitId?: string | undefined; status?: WorkOrderStatus | undefined } = {},
) {
  return useInfiniteQuery({
    queryKey: ['work-orders', filters],
    queryFn: ({ pageParam }) =>
      request<Page<WorkOrderItem>>(
        `/api/owner/work-orders${qs({ ...filters, cursor: pageParam, limit: 50 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: ['work-order', id],
    queryFn: () => request<WorkOrderDetail>(`/api/owner/work-orders/${id}`),
  });
}

export function useUnitTimeline(unitId: string, kinds: TimelineKind[] | undefined) {
  return useInfiniteQuery({
    queryKey: ['timeline', unitId, kinds ?? []],
    queryFn: ({ pageParam }) =>
      request<Page<TimelineEntry>>(
        `/api/owner/units/${unitId}/timeline${qs({ kinds: kinds?.join(','), cursor: pageParam, limit: 30 })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** One request per visible range; the range is the cache key. */
export function useCalendar(from: string, to: string, kinds?: string[]) {
  return useQuery({
    queryKey: ['calendar', from, to, kinds ?? []],
    queryFn: () =>
      request<CalendarResponse>(`/api/owner/calendar${qs({ from, to, kinds: kinds?.join(',') })}`),
    staleTime: 5 * 60_000,
  });
}
