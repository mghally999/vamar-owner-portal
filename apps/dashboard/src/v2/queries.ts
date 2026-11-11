/**
 * TanStack Query hooks over the v2 staff endpoints (calendar, records, dispute cheques, settings,
 * holidays, categories, vendors). Keys: ['v2', <area>, ...].
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarItemKind, TimelineKind } from '@vamar/shared';
import { qs, request } from '@/lib/api';
import type { DisputeStatus } from '@vamar/shared';
import type { ChequeRow, Page } from '@/lib/types';
import type {
  CalendarEvent,
  CalendarItem,
  DisputeCheque,
  DisputeRowV2,
  ExpenseCategory,
  ExpenseRowV2,
  Holiday,
  Settings,
  TimelinePage,
  UnitRecord,
  UnitStatusEvent,
  Vendor,
} from './types';

export const v2keys = {
  calendar: (f: Record<string, string | undefined>) => ['v2', 'calendar', f] as const,
  event: (id: string) => ['v2', 'event', id] as const,
  holidays: (year?: number) => ['v2', 'holidays', year ?? 0] as const,
  settings: ['v2', 'settings'] as const,
  categories: (includeInactive: boolean) => ['v2', 'categories', includeInactive] as const,
  vendors: (f: Record<string, string | boolean | undefined>) => ['v2', 'vendors', f] as const,
  unit: (id: string) => ['v2', 'unit', id] as const,
  unitStatusHistory: (id: string) => ['v2', 'unit-status-history', id] as const,
  unitTimeline: (id: string, f: Record<string, string | undefined>) =>
    ['v2', 'unit-timeline', id, f] as const,
  buildingTimeline: (id: string, f: Record<string, string | undefined>) =>
    ['v2', 'building-timeline', id, f] as const,
  unitCheques: (unitId: string) => ['v2', 'unit-cheques', unitId] as const,
  disputeExpenses: (disputeId: string) => ['v2', 'dispute-expenses', disputeId] as const,
  disputes: (f: Record<string, string | undefined>) => ['disputes', 'v2', f] as const,
};

// Calendar ---------------------------------------------------------------------------------------

export interface CalendarFilters {
  from: string;
  to: string;
  buildingId?: string | undefined;
  ownerId?: string | undefined;
  kinds?: CalendarItemKind[] | undefined;
}

export function useCalendar(f: CalendarFilters, enabled = true) {
  const flat = { ...f, kinds: f.kinds?.join(',') };
  return useQuery({
    queryKey: v2keys.calendar(flat),
    queryFn: () =>
      request<{ items: CalendarItem[] }>(`/api/staff/calendar${qs(flat)}`).then((r) => r.items),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useCalendarEvent(id: string | null) {
  return useQuery({
    queryKey: v2keys.event(id ?? ''),
    queryFn: () => request<CalendarEvent>(`/api/staff/calendar-events/${id ?? ''}`),
    enabled: id !== null,
  });
}

function invalidateCalendar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['v2', 'calendar'] });
  void qc.invalidateQueries({ queryKey: ['v2', 'event'] });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      request<CalendarEvent>('/api/staff/calendar-events', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateCalendar(qc);
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
      request<CalendarEvent>(`/api/staff/calendar-events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      invalidateCalendar(qc);
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/api/staff/calendar-events/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateCalendar(qc);
    },
  });
}

// Holidays -----------------------------------------------------------------------------------------

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: v2keys.holidays(year),
    queryFn: () =>
      request<{ items: Holiday[] }>(`/api/staff/holidays${qs({ year })}`).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

export function useUpsertHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Holiday) =>
      request<Holiday>('/api/staff/holidays', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['v2', 'holidays'] }),
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => request(`/api/staff/holidays/${date}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['v2', 'holidays'] }),
  });
}

// Settings -----------------------------------------------------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: v2keys.settings,
    queryFn: () => request<Settings>('/api/staff/settings'),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      request<Settings>('/api/staff/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (data) => {
      qc.setQueryData(v2keys.settings, data);
    },
  });
}

// Categories and vendors ---------------------------------------------------------------------------

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: v2keys.categories(includeInactive),
    queryFn: () =>
      request<{ items: ExpenseCategory[] }>(
        `/api/staff/expense-categories${qs({ includeInactive: includeInactive ? '1' : undefined })}`,
      ).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string } & Record<string, unknown>) =>
      id
        ? request<ExpenseCategory>(`/api/staff/expense-categories/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : request<ExpenseCategory>('/api/staff/expense-categories', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['v2', 'categories'] }),
  });
}

export function useVendors(f: { search?: string | undefined; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: v2keys.vendors(f),
    queryFn: () =>
      request<{ items: Vendor[] }>(
        `/api/staff/vendors${qs({ search: f.search, includeInactive: f.includeInactive ? '1' : undefined })}`,
      ).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useSaveVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string } & Record<string, unknown>) =>
      id
        ? request<Vendor>(`/api/staff/vendors/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : request<Vendor>('/api/staff/vendors', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['v2', 'vendors'] }),
  });
}

// Property records ---------------------------------------------------------------------------------

export function useUnitRecord(id: string) {
  return useQuery({
    queryKey: v2keys.unit(id),
    queryFn: () => request<UnitRecord>(`/api/staff/units/${id}`),
  });
}

export function useUnitStatusHistory(id: string) {
  return useQuery({
    queryKey: v2keys.unitStatusHistory(id),
    queryFn: () =>
      request<{ items: UnitStatusEvent[] }>(`/api/staff/units/${id}/status-history`).then(
        (r) => r.items,
      ),
  });
}

export function useSetUnitStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: string; reason: string }) =>
      request<UnitRecord>(`/api/staff/units/${id}/status`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: v2keys.unit(id) });
      void qc.invalidateQueries({ queryKey: v2keys.unitStatusHistory(id) });
      void qc.invalidateQueries({ queryKey: ['v2', 'unit-timeline', id] });
      void qc.invalidateQueries({ queryKey: ['building'] });
    },
  });
}

export function useSetUnitIdentifiers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, string | null>) =>
      request<UnitRecord>(`/api/staff/units/${id}/identifiers`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: v2keys.unit(id) });
      void qc.invalidateQueries({ queryKey: ['building'] });
    },
  });
}

export function useSetBuildingIdentifiers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, string | number | null>) =>
      request(`/api/staff/buildings/${id}/identifiers`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['building', id] });
      void qc.invalidateQueries({ queryKey: ['buildings'] });
    },
  });
}

export interface TimelineFilters {
  kinds?: TimelineKind[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export function useUnitTimeline(id: string, f: TimelineFilters) {
  const flat = { kinds: f.kinds?.join(','), cursor: f.cursor, limit: String(f.limit ?? 30) };
  return useQuery({
    queryKey: v2keys.unitTimeline(id, flat),
    queryFn: () => request<TimelinePage>(`/api/staff/units/${id}/timeline${qs(flat)}`),
    placeholderData: (prev) => prev,
  });
}

export function useBuildingTimeline(id: string, f: TimelineFilters, enabled = true) {
  const flat = { kinds: f.kinds?.join(','), cursor: f.cursor, limit: String(f.limit ?? 30) };
  return useQuery({
    queryKey: v2keys.buildingTimeline(id, flat),
    queryFn: () => request<TimelinePage>(`/api/staff/buildings/${id}/timeline${qs(flat)}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

// Disputes and cheques -----------------------------------------------------------------------------

/** Cheques of the unit's contracts, for the case forms (a unit has at most a few dozen). */
export function useUnitCheques(unitId: string) {
  return useQuery({
    queryKey: v2keys.unitCheques(unitId),
    queryFn: () =>
      request<Page<ChequeRow>>(`/api/staff/cheques${qs({ unitId, limit: 100 })}`).then(
        (r) => r.items,
      ),
    enabled: unitId !== '',
  });
}

export function useSetDisputeCheques(disputeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chequeIds: string[]) =>
      request<{ items: DisputeCheque[] }>(`/api/staff/disputes/${disputeId}/cheques`, {
        method: 'PUT',
        body: JSON.stringify({ chequeIds }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dispute', disputeId] });
      void qc.invalidateQueries({ queryKey: ['disputes'] });
    },
  });
}

/** The dispute list with the cheque numbers and a case-or-cheque-number search. */
export function useDisputesV2(filters: {
  status?: DisputeStatus | undefined;
  buildingId?: string | undefined;
  search?: string | undefined;
  hearingFrom?: string | undefined;
  hearingTo?: string | undefined;
}) {
  return useQuery({
    queryKey: v2keys.disputes(filters),
    queryFn: () =>
      request<Page<DisputeRowV2>>(`/api/staff/disputes${qs({ ...filters, limit: 100 })}`).then(
        (r) => r.items,
      ),
  });
}

export function useDisputeExpenses(disputeId: string) {
  return useQuery({
    queryKey: v2keys.disputeExpenses(disputeId),
    queryFn: () =>
      request<{ items: ExpenseRowV2[] }>(`/api/staff/expenses${qs({ disputeId, limit: 50 })}`).then(
        (r) => r.items,
      ),
  });
}
