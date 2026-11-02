import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  useBuildings,
  useCheques,
  useDevices,
  useDisputes,
  useMe,
  useRequestDeletion,
  useRevokeOtherDevices,
  useSetLang,
  useUnits,
} from '@/lib/queries';
import { mockApi, sent } from '@/test/api';
import { building, cheque, deviceItem, dispute, unit } from '@/test/fixtures';
import { testQueryClient } from '@/test/render';

async function hook<T>(use: () => T) {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(use, { wrapper });
}

describe('owner queries', () => {
  it('loads the owner profile', async () => {
    mockApi({ 'GET /api/owner/me': { body: { id: 'owner-1', nameEn: 'Salem' } } });
    const { result } = await hook(() => useMe());
    await waitFor(() => {
      expect(result.current.data).toEqual({ id: 'owner-1', nameEn: 'Salem' });
    });
  });

  it('unwraps buildings and units, filtering units by building and flagging a cut-off list', async () => {
    mockApi({
      'GET /api/owner/buildings': { body: { items: [building()] } },
      'GET /api/owner/units': (req) =>
        req.query.get('buildingId') === 'bld-1'
          ? { body: { items: [unit()], truncated: true } }
          : { body: { items: [] } },
    });
    const { result } = await hook(() => ({
      buildings: useBuildings(),
      all: useUnits(),
      one: useUnits('bld-1'),
    }));
    await waitFor(() => {
      expect(result.current.one.data).toEqual({ items: [unit()], truncated: true });
    });
    expect(result.current.buildings.data).toEqual([building()]);
    expect(result.current.all.data).toEqual({ items: [], truncated: false });
  });

  it('pages through cheques with the filters and a cursor, 50 at a time', async () => {
    mockApi({
      'GET /api/owner/cheques': (req) =>
        req.query.get('cursor') === 'next-1'
          ? { body: { items: [cheque({ id: 'chq-2' })], nextCursor: null } }
          : { body: { items: [cheque()], nextCursor: 'next-1' } },
    });
    const { result } = await hook(() =>
      useCheques({ month: '2026-10', buildingId: 'bld-1', status: 'bounced', unitId: undefined }),
    );
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });
    await act(() => result.current.fetchNextPage());
    await waitFor(() => {
      expect(result.current.data?.pages.flatMap((p) => p.items.map((c) => c.id))).toEqual([
        'chq-1',
        'chq-2',
      ]);
    });
    expect(result.current.hasNextPage).toBe(false);
    const [first, second] = sent('GET /api/owner/cheques');
    expect(Object.fromEntries(first?.query ?? [])).toEqual({
      month: '2026-10',
      buildingId: 'bld-1',
      status: 'bounced',
      limit: '50',
    });
    expect(second?.query.get('cursor')).toBe('next-1');
  });

  it('pages through disputes', async () => {
    mockApi({
      'GET /api/owner/disputes': (req) =>
        req.query.get('cursor')
          ? { body: { items: [dispute({ id: 'dsp-2' })], nextCursor: null } }
          : { body: { items: [dispute()], nextCursor: 'c2' } },
    });
    const { result } = await hook(() => useDisputes());
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });
    await act(() => result.current.fetchNextPage());
    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2);
    });
  });

  it('reloads the device list after signing out the other devices', async () => {
    let revoked = false;
    mockApi({
      'GET /api/auth/owner/devices': () => ({
        body: {
          items: [
            deviceItem(),
            deviceItem({ id: 'dev-2', current: false, revokedAt: revoked ? 'x' : null }),
          ],
        },
      }),
      'POST /api/auth/owner/devices/revoke-others': () => {
        revoked = true;
        return { body: { ok: true } };
      },
    });
    const { result } = await hook(() => ({
      devices: useDevices(),
      revoke: useRevokeOtherDevices(),
    }));
    await waitFor(() => {
      expect(result.current.devices.data?.[1]?.revokedAt).toBeNull();
    });
    await act(() => result.current.revoke.mutateAsync());
    await waitFor(() => {
      expect(result.current.devices.data?.[1]?.revokedAt).toBe('x');
    });
    expect(sent('GET /api/auth/owner/devices')).toHaveLength(2);
  });

  it('sends the deletion request with its reason and the preferred language', async () => {
    mockApi({
      'POST /api/owner/account/delete-request': { body: { ok: true } },
      'PATCH /api/owner/me': { body: { ok: true } },
    });
    const { result } = await hook(() => ({ del: useRequestDeletion(), lang: useSetLang() }));
    await act(() => result.current.del.mutateAsync('Sold the flat'));
    await act(() => result.current.lang.mutateAsync('en'));
    expect(sent('POST /api/owner/account/delete-request')[0]?.body).toEqual({
      reason: 'Sold the flat',
    });
    expect(sent('PATCH /api/owner/me')[0]?.body).toEqual({ preferredLang: 'en' });
  });
});
