/** Pure version logic for the update check (no native modules, unit tested). */
export interface VersionInfo {
  latestVersion: string;
  minimumVersion: string;
  downloadUrl: string;
  apkUrl: string;
}

/** Compares dotted numeric versions: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export type UpdateState =
  | { kind: 'current' }
  | { kind: 'available'; info: VersionInfo; installed: string }
  | { kind: 'required'; info: VersionInfo; installed: string };

export function updateStateFor(installed: string, info: VersionInfo): UpdateState {
  if (compareVersions(installed, info.minimumVersion) < 0)
    return { kind: 'required', info, installed };
  if (compareVersions(installed, info.latestVersion) < 0)
    return { kind: 'available', info, installed };
  return { kind: 'current' };
}
