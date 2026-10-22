/**
 * Update check against GET /api/app/version. The installed version comes from the native build
 * (versionName), so a JavaScript-only update cannot pretend to be a newer install.
 */
import { useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import { API_BASE } from './api';
import { updateStateFor, type UpdateState, type VersionInfo } from './semver';

export type { UpdateState, VersionInfo };

export function installedVersion(): string {
  return Application.nativeApplicationVersion ?? '0.0.0';
}

/** Checks once per launch and then hourly; a failed check never blocks the app. */
export function useUpdateState(): UpdateState {
  const q = useQuery({
    queryKey: ['app-version'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/app/version`);
      if (!res.ok) throw new Error(`version check ${res.status}`);
      return (await res.json()) as VersionInfo;
    },
    staleTime: 60 * 60_000,
    retry: 1,
  });
  return q.data ? updateStateFor(installedVersion(), q.data) : { kind: 'current' };
}
