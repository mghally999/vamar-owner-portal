// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCreateVendor } from '@/lib/queries-v2';
import { mockApi } from '@/test/api';
import { testQueryClient } from '@/test/render';
import {
  useDeleteHoliday,
  useSaveCategory,
  useSaveVendor,
  useUpdateSettings,
  useUpsertHoliday,
} from './queries';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The same lists are cached under two key families: ['v2', ...] for the admin pages and the bare
 * keys of lib/queries-v2.ts for the date pickers, period bars and expense forms. A change on
 * either side must mark both stale.
 */
function setup() {
  const qc = testQueryClient();
  for (const key of [
    ['settings'],
    ['v2', 'settings'],
    ['holidays', 'all'],
    ['v2', 'holidays', 2026],
    ['expense-categories', false],
    ['v2', 'categories', false],
    ['vendors', ''],
    ['v2', 'vendors', {}],
  ]) {
    qc.setQueryData(key, []);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const stale = (key: unknown[]) => qc.getQueryState(key)?.isInvalidated;
  return { qc, wrapper, stale };
}

describe('reference data stays in step across both caches', () => {
  it('settings', async () => {
    mockApi({ 'PATCH /api/staff/settings': { weekStart: 'sunday' } });
    const { wrapper, stale, qc } = setup();
    const { result } = renderHook(() => useUpdateSettings(), { wrapper });
    await result.current.mutateAsync({});
    await waitFor(() => {
      expect(stale(['settings'])).toBe(true);
    });
    expect(qc.getQueryData(['v2', 'settings'])).toEqual({ weekStart: 'sunday' });
  });

  it('holidays, saved or removed', async () => {
    mockApi({ 'PUT /api/staff/holidays': {}, 'DELETE /api/staff/holidays/:date': {} });
    const { wrapper, stale } = setup();
    const upsert = renderHook(() => useUpsertHoliday(), { wrapper });
    await upsert.result.current.mutateAsync({
      date: '2026-12-02',
      nameAr: 'اليوم الوطني',
      nameEn: 'National Day',
      tentative: false,
    });
    await waitFor(() => {
      expect(stale(['holidays', 'all'])).toBe(true);
    });
    expect(stale(['v2', 'holidays', 2026])).toBe(true);

    const second = setup();
    const del = renderHook(() => useDeleteHoliday(), { wrapper: second.wrapper });
    await del.result.current.mutateAsync('2026-12-02');
    await waitFor(() => {
      expect(second.stale(['holidays', 'all'])).toBe(true);
    });
  });

  it('categories', async () => {
    mockApi({ 'POST /api/staff/expense-categories': {} });
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useSaveCategory(), { wrapper });
    await result.current.mutateAsync({ nameEn: 'Lifts' });
    await waitFor(() => {
      expect(stale(['expense-categories', false])).toBe(true);
    });
    expect(stale(['v2', 'categories', false])).toBe(true);
  });

  it('vendors, from the vendors page or from the expense form', async () => {
    mockApi({ 'POST /api/staff/vendors': {} });
    const page = setup();
    const save = renderHook(() => useSaveVendor(), { wrapper: page.wrapper });
    await save.result.current.mutateAsync({ name: 'Lift Co' });
    await waitFor(() => {
      expect(page.stale(['vendors', ''])).toBe(true);
    });
    expect(page.stale(['v2', 'vendors', {}])).toBe(true);

    const form = setup();
    const create = renderHook(() => useCreateVendor(), { wrapper: form.wrapper });
    await create.result.current.mutateAsync({ name: 'Lift Co' });
    await waitFor(() => {
      expect(form.stale(['v2', 'vendors', {}])).toBe(true);
    });
    expect(form.stale(['vendors', ''])).toBe(true);
  });
});
