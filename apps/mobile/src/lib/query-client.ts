/**
 * The app's React Query client and what keeps it honest: queries pause while the phone is
 * offline and resume on reconnect (what was fetched last stays on screen, see OfflineBanner),
 * stale screens refetch when the owner comes back to the app while polling stops in the
 * background, and nothing fetched for one owner survives their sign-out.
 */
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { AuthStage } from './auth';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 60 * 60_000,
        retry: (failureCount, error) => {
          if (failureCount >= 2) return false;
          const status = (error as { status?: number }).status ?? 0;
          return status === 0 || status >= 500;
        },
        networkMode: 'offlineFirst',
      },
    },
  });
}

/** Called once at start (root layout). */
export function connectOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
}

/**
 * React Query knows the app is in front from the page's visibility, which a phone does not have:
 * without this, nothing refetches when the owner returns to the app after hours, and
 * `refetchInterval` keeps polling in the background. The web app keeps the built-in listener.
 */
export function connectFocusManager(): void {
  if (Platform.OS === 'web') return;
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (state) => {
      setFocused(state === 'active');
    });
    return () => {
      sub.remove();
    };
  });
}

/**
 * Empties the cache when a session ends (sign-out, or a session refused by the server): the next
 * owner on this phone or browser must not see the previous owner's figures, even for a moment.
 * By then the owner's screens are gone; what is still on screen (the root layout's version check)
 * keeps its query.
 */
export function useClearCacheWhenSignedOut(client: QueryClient, stage: AuthStage): void {
  const previous = useRef(stage);
  useEffect(() => {
    const ended = previous.current === 'authenticated' && stage === 'anonymous';
    previous.current = stage;
    if (!ended) return;
    const cache = client.getQueryCache();
    for (const query of cache.findAll()) if (query.getObserversCount() === 0) cache.remove(query);
    client.getMutationCache().clear();
  }, [client, stage]);
}
