'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, loginWithTelegram, getToken } from '../lib/api';
import { getWebApp } from '../lib/telegram';

export interface AuthStatus {
  ready: boolean;
  error: string | null;
  /** Try logging in again after an error. */
  retry: () => void;
}

export function useAuth(): AuthStatus {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const wa = getWebApp();
    wa?.ready();
    wa?.expand();
    // Bot API 7.7+: vertical swipes scroll the app instead of dragging Telegram's sheet down
    // (diagonal day swipes moved the whole panel). Collapse / close stay in the header.
    if (wa?.isVersionAtLeast?.('7.7')) wa.disableVerticalSwipes?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // A stored token may be expired — api() re-logs in transparently on 401.
    if (getToken()) {
      setReady(true);
      return;
    }
    (async () => {
      // The backend may be mid-restart (deploy, memory-limit restart): retry a
      // couple of times before showing an error. Bad initData (4xx) is final.
      for (let i = 0; ; i++) {
        try {
          await loginWithTelegram();
          break;
        } catch (e) {
          const final = i >= 2 || !(e instanceof ApiError) || (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429);
          if (cancelled) return;
          if (final) {
            setError((e as Error).message);
            break;
          }
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          if (cancelled) return;
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setReady(false);
    setAttempt((a) => a + 1);
  }, []);

  return { ready, error, retry };
}
