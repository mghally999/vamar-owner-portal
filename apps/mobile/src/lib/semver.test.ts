import { describe, expect, it } from 'vitest';
import { compareVersions, updateStateFor, type VersionInfo } from './semver';

const info: VersionInfo = {
  latestVersion: '1.2.0',
  minimumVersion: '1.1.0',
  downloadUrl: 'https://x/download',
  apkUrl: 'https://x/download/vamar-owner-app.apk',
};

describe('update check', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('requires, offers or skips an update', () => {
    expect(updateStateFor('1.0.5', info).kind).toBe('required');
    expect(updateStateFor('1.1.0', info).kind).toBe('available');
    expect(updateStateFor('1.2.0', info).kind).toBe('current');
    expect(updateStateFor('2.0.0', info).kind).toBe('current');
  });
});
