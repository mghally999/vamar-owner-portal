import { describe, expect, it, vi } from 'vitest';
import { endServerSession } from './sign-out';

describe('endServerSession', () => {
  it('logs out with the token the push call rotated, not the one it replaced', async () => {
    let stored: string | null = 'refresh-1';
    const calls: string[] = [];
    // The push-token DELETE meets a 401 and the api client rotates the session.
    const forgetPushToken = vi.fn(() => {
      calls.push('DELETE /api/owner/push-token');
      stored = 'refresh-2';
      return Promise.resolve();
    });
    const logout = vi.fn((token: string) => {
      calls.push(`POST /api/auth/owner/logout ${token}`);
      return Promise.resolve();
    });
    await endServerSession({
      readRefreshToken: () => Promise.resolve(stored),
      forgetPushToken,
      logout,
    });
    expect(calls).toEqual([
      'DELETE /api/owner/push-token',
      'POST /api/auth/owner/logout refresh-2',
    ]);
  });

  it('calls nothing without a session, and shrugs off an offline logout', async () => {
    const forgetPushToken = vi.fn(() => Promise.resolve());
    const logout = vi.fn(() => Promise.reject(new Error('offline')));
    await endServerSession({
      readRefreshToken: () => Promise.resolve(null),
      forgetPushToken,
      logout,
    });
    expect(forgetPushToken).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    await expect(
      endServerSession({
        readRefreshToken: () => Promise.resolve('refresh-1'),
        forgetPushToken,
        logout,
      }),
    ).resolves.toBeUndefined();
    expect(logout).toHaveBeenCalledWith('refresh-1');
  });
});
