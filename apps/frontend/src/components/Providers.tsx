'use client';

import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, subscribeActiveGroup } from '../lib/api';
import { getWebApp, syncTheme } from '../lib/telegram';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 4xx (no group, forbidden, not found) won't fix itself on retry —
            // retrying only multiplies load on the small server. Timeouts (408)
            // and rate limits (429) do, after React Query's backoff.
            retry: (count, err) => count < 2 && !(err instanceof ApiError && isClientError(err.status)),
            // Coming back to the Mini App refreshes anything older than staleTime.
            refetchOnWindowFocus: true,
            staleTime: 30_000,
          },
        },
      }),
  );
  useEffect(() => syncTheme(), []);
  // Group-scoped data is cached under keys without the group id (sent as the
  // x-group-id header), so anything fetched before / for another group is
  // wrong once the active group changes — refetch all but the user profile.
  useEffect(
    () => subscribeActiveGroup(() => client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' })),
    [client],
  );
  // Telegram's minimize/restore often leaves document.visibilityState alone,
  // so polling kept running in a collapsed Mini App and nothing refreshed on
  // return. Feed Telegram's activated/deactivated events into React Query.
  useEffect(() => {
    focusManager.setEventListener((setFocused) => {
      const wa = getWebApp();
      const onVisibility = () => setFocused(document.visibilityState !== 'hidden');
      const onActive = () => setFocused(true);
      const onInactive = () => setFocused(false);
      document.addEventListener('visibilitychange', onVisibility);
      wa?.onEvent?.('activated', onActive);
      wa?.onEvent?.('deactivated', onInactive);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        wa?.offEvent?.('activated', onActive);
        wa?.offEvent?.('deactivated', onInactive);
      };
    });
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function isClientError(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
