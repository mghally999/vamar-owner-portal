import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { installedVersion, useUpdateState } from '@/lib/version';
import { mockApi, sent } from '@/test/api';
import { application } from '@/test/native';
import { testQueryClient } from '@/test/render';

const info = {
  latestVersion: '1.6.0',
  minimumVersion: '1.2.0',
  downloadUrl: 'https://vamar.ae/app',
  apkUrl: 'https://vamar.ae/app.apk',
};

async function check() {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = await renderHook(() => useUpdateState(), { wrapper });
  return { ...hook, client };
}

describe('update check', () => {
  it('reads the installed version from the native build', () => {
    expect(installedVersion()).toBe('1.4.0');
    application.nativeApplicationVersion = null;
    expect(installedVersion()).toBe('0.0.0');
  });

  it('offers a newer version without blocking', async () => {
    mockApi({ 'GET /api/app/version': { body: info } });
    const { result } = await check();
    await waitFor(() => {
      expect(result.current).toEqual({ kind: 'available', info, installed: '1.4.0' });
    });
  });

  it('requires an update below the minimum version', async () => {
    mockApi({ 'GET /api/app/version': { body: { ...info, minimumVersion: '1.5.0' } } });
    const { result } = await check();
    await waitFor(() => {
      expect(result.current.kind).toBe('required');
    });
  });

  it('is current on the latest version', async () => {
    mockApi({ 'GET /api/app/version': { body: { ...info, latestVersion: '1.4.0' } } });
    const { result } = await check();
    await waitFor(() => {
      expect(sent('GET /api/app/version')).toHaveLength(1);
    });
    expect(result.current).toEqual({ kind: 'current' });
  });

  it('never blocks the app when the check fails', async () => {
    mockApi({ 'GET /api/app/version': { status: 503, body: {} } });
    const { result, client } = await check();
    await waitFor(() => {
      expect(sent('GET /api/app/version')).toHaveLength(1);
    });
    expect(result.current).toEqual({ kind: 'current' });
    client.clear();
  });

  it('does not check on the web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    mockApi({ 'GET /api/app/version': { body: { ...info, minimumVersion: '9.0.0' } } });
    const { result } = await check();
    expect(result.current).toEqual({ kind: 'current' });
    expect(sent('GET /api/app/version')).toHaveLength(0);
  });
});
