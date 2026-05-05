'use client';

import { useEffect, useState } from 'react';
import { loginWithTelegram, getToken, getActiveGroup, setActiveGroup } from '../lib/api';
import { getWebApp } from '../lib/telegram';

export interface AuthStatus {
  ready: boolean;
  error: string | null;
  userId: string | null;
  activeGroupId: string | null;
  setActiveGroup: (groupId: string | null) => void;
}

export function useAuth(): AuthStatus {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const wa = getWebApp();
    wa?.ready();
    wa?.expand();
    const existing = getToken();
    if (existing) {
      setReady(true);
      setActiveGroupState(getActiveGroup());
      return;
    }
    (async () => {
      try {
        const r = await loginWithTelegram();
        if (cancelled) return;
        setUserId(r.userId);
        setActiveGroupState(getActiveGroup());
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ready,
    error,
    userId,
    activeGroupId,
    setActiveGroup: (g) => {
      setActiveGroup(g);
      setActiveGroupState(g);
    },
  };
}
