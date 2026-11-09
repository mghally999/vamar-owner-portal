// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi } from '@/test/api';
import { testQueryClient } from '@/test/render';
import {
  keys,
  prefetchBuilding,
  prefetchCheque,
  prefetchContract,
  prefetchDispute,
  prefetchOwner,
  useUploadAttachment,
} from './queries';
import { useDeleteFile, useUploadFile, v2keys } from './queries-v2';

vi.mock('@/lib/firebase', () => ({
  firebaseEmailLogin: vi.fn(),
  firebaseSendVerificationEmail: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });

describe('prefetch on hover', () => {
  it('never throws when the page behind a row cannot be loaded', async () => {
    const api = mockApi({
      'GET /api/staff/owners/:id': apiError(500, 'internal'),
      'GET /api/staff/buildings/:id': apiError(404, 'not_found'),
      'GET /api/staff/contracts/:id': apiError(500, 'internal'),
      'GET /api/staff/cheques/:id': apiError(500, 'internal'),
      'GET /api/staff/disputes/:id': apiError(500, 'internal'),
    });
    const qc = testQueryClient();
    prefetchOwner(qc, 'own-1');
    prefetchBuilding(qc, 'bld-1');
    prefetchContract(qc, 'con-1');
    prefetchCheque(qc, 'chq-1');
    prefetchDispute(qc, 'dsp-1');
    await waitFor(() => {
      expect(api.calls).toHaveLength(5);
    });
    await waitFor(() => {
      expect(qc.getQueryState(keys.dispute('dsp-1'))?.status).toBe('error');
    });
    expect(qc.getQueryData(keys.owner('own-1'))).toBeUndefined();
  });
});

describe('file mutations refresh what they change', () => {
  it('uploads to a contract or unit without touching the dispute, and to a dispute refreshing it', async () => {
    mockApi({ 'POST /api/staff/attachments': { id: 'att-1' } });
    const qc = testQueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUploadAttachment(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ entityType: 'contract', entityId: 'con-1', file: file() });
    });
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.mutateAsync({ entityType: 'dispute', entityId: 'dsp-1', file: file() });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.dispute('dsp-1') });
  });

  it('the v2 uploader refreshes the expense, the work order or the dispute it was added to', async () => {
    mockApi({
      'POST /api/staff/attachments': { id: 'att-1' },
      'DELETE /api/staff/attachments/:id': { ok: true },
    });
    const qc = testQueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const upload = renderHook(() => useUploadFile(), { wrapper });
    for (const [entityType, key] of [
      ['expense', v2keys.expense('e-1')],
      ['work_order', v2keys.workOrder('e-1')],
      ['dispute', keys.dispute('e-1')],
    ] as const) {
      invalidate.mockClear();
      await act(async () => {
        await upload.result.current.mutateAsync({ entityType, entityId: 'e-1', file: file() });
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    invalidate.mockClear();
    await act(async () => {
      await upload.result.current.mutateAsync({
        entityType: 'unit',
        entityId: 'u-1',
        file: file(),
      });
    });
    expect(invalidate).not.toHaveBeenCalled();
    const remove = renderHook(() => useDeleteFile(), { wrapper });
    await act(async () => {
      await remove.result.current.mutateAsync('att-1');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-order'] });
  });
});
