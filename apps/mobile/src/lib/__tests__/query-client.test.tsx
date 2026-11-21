import { focusManager, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { AppState, Platform, Text, type AppStateStatus } from 'react-native';
import type { AuthStage } from '@/lib/auth';
import {
  connectFocusManager,
  createQueryClient,
  useClearCacheWhenSignedOut,
} from '@/lib/query-client';

function Screen({ stage }: { stage: AuthStage }) {
  return <Text>{stage}</Text>;
}

describe('the query cache across owners', () => {
  it('keeps the signed-in owner data and drops all of it once nobody is signed in', async () => {
    const client = createQueryClient();
    client.setQueryData(['summary', 'this_month'], { netFils: 100 });
    function Harness({ stage }: { stage: AuthStage }) {
      useClearCacheWhenSignedOut(client, stage);
      const q = useQuery({ queryKey: ['me'], queryFn: () => Promise.resolve('owner-1') });
      return (
        <>
          <Screen stage={stage} />
          <Text>{q.data ?? 'none'}</Text>
        </>
      );
    }
    const view = await render(
      <QueryClientProvider client={client}>
        <Harness stage="loading" />
      </QueryClientProvider>,
    );
    // Starting the app signed out is not an ending session: nothing is dropped.
    await view.rerender(
      <QueryClientProvider client={client}>
        <Harness stage="anonymous" />
      </QueryClientProvider>,
    );
    expect(client.getQueryData(['summary', 'this_month'])).toEqual({ netFils: 100 });
    await view.rerender(
      <QueryClientProvider client={client}>
        <Harness stage="authenticated" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('owner-1')).toBeTruthy();
    expect(client.getQueryData(['summary', 'this_month'])).toEqual({ netFils: 100 });

    await view.rerender(
      <QueryClientProvider client={client}>
        <Harness stage="anonymous" />
      </QueryClientProvider>,
    );
    expect(client.getQueryData(['summary', 'this_month'])).toBeUndefined();
    // A query still on screen keeps its data (the root layout's version check).
    expect(client.getQueryData(['me'])).toBe('owner-1');
    client.clear();
  });

  it('retries a dead connection or a server error twice, never a refused request', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, { status: 503 })).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(true);
    expect(retry(2, { status: 503 })).toBe(false);
    expect(retry(0, { status: 404 })).toBe(false);
    expect(retry(0, { status: 401 })).toBe(false);
  });
});

describe('the app coming to the front', () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
  });

  it('refetches stale screens on return and stops polling in the background', async () => {
    let emit: ((s: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      emit = listener as (s: AppStateStatus) => void;
      return { remove } as never;
    });
    connectFocusManager();
    const client = createQueryClient();
    let calls = 0;
    function Poller() {
      useQuery({
        queryKey: ['thread'],
        queryFn: () => Promise.resolve((calls += 1)),
        staleTime: 0,
        refetchInterval: 50,
      });
      return null;
    }
    await render(
      <QueryClientProvider client={client}>
        <Poller />
      </QueryClientProvider>,
    );
    await act(async () => {
      emit?.('background');
      await new Promise((r) => setTimeout(r, 30));
    });
    const inBackground = calls;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // No polling while away.
    expect(calls).toBe(inBackground);
    await act(async () => {
      emit?.('active');
      await new Promise((r) => setTimeout(r, 20));
    });
    // Back in front: fetched again at once.
    expect(calls).toBeGreaterThan(inBackground);
    client.clear();
  });

  it('leaves the web app on the page visibility listener', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const spy = jest.spyOn(focusManager, 'setEventListener');
    connectFocusManager();
    expect(spy).not.toHaveBeenCalled();
  });
});
