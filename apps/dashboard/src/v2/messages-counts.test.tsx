// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_AFTER_MS } from '@/lib/activity';
import { mockApi } from '@/test/api';
import { testQueryClient } from '@/test/render';
import { useMessageCounts } from './messages-queries';

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

afterEach(() => {
  cleanup();
  visibility = 'visible';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Counter() {
  const q = useMessageCounts();
  return <p>{q.data?.unreadThreads ?? '-'}</p>;
}

function setup() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const api = mockApi({ 'GET /api/staff/messages/counts': { unreadThreads: 2, waiting: 0 } });
  render(
    <QueryClientProvider client={testQueryClient()}>
      <Counter />
    </QueryClientProvider>,
  );
  return () => api.to('GET', '/api/staff/messages/counts').length;
}

/** Minutes pass with someone using the page. */
async function useFor(minutes: number) {
  for (let i = 0; i < minutes; i += 1) {
    window.dispatchEvent(new KeyboardEvent('keydown'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
  }
}

describe('message count poll', () => {
  it('polls every minute while used, stops when idle, and catches up on return', async () => {
    const calls = setup();
    await vi.waitFor(() => {
      expect(calls()).toBe(1);
    });
    await useFor(3);
    expect(calls()).toBeGreaterThanOrEqual(4);
    const beforeIdle = calls();
    // Nobody touches the page for an hour: at most the polls until the idle mark.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(calls() - beforeIdle).toBeLessThanOrEqual(IDLE_AFTER_MS / 60_000);
    const idle = calls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(calls()).toBe(idle);
    // Someone moves the mouse: the stale count is fetched at once.
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    await vi.waitFor(() => {
      expect(calls()).toBe(idle + 1);
    });
  });

  it('does not poll a hidden tab', async () => {
    const calls = setup();
    await vi.waitFor(() => {
      expect(calls()).toBe(1);
    });
    act(() => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(calls()).toBe(1);
    act(() => {
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => {
      expect(calls()).toBe(2);
    });
  });
});
