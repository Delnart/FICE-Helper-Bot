'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMe } from './useMe';

/** A message from the developer to everyone who uses the app (written with /notice in the admins' chat). */
export interface Notice {
  _id: string;
  title: string;
  body: string;
  createdAt: string;
}

// What the reader has seen is kept in this browser: the `createdAt` of the newest message seen.
const KEY = 'fice_notices_seen';
/** With nothing kept yet (a first visit), a message counts as new for two weeks. */
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;

// Also held here, so that with storage blocked a message closed once stays closed for the visit.
let seenAt: string | null | undefined;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const getSeen = (): string | null => {
  if (seenAt === undefined) {
    try {
      seenAt = localStorage.getItem(KEY);
    } catch {
      seenAt = null;
    }
  }
  return seenAt;
};

/** Messages newer than this are new to the reader. ISO dates, so they compare as strings. */
export const noticesSeenUpTo = (): string => getSeen() ?? new Date(Date.now() - FRESH_MS).toISOString();

/** The message of that time and everything before it has been seen. */
export function markNoticesSeen(createdAt: string): void {
  if ((getSeen() ?? '') >= createdAt) return;
  seenAt = createdAt;
  try {
    localStorage.setItem(KEY, createdAt);
  } catch {
    /* storage blocked: kept for this visit only */
  }
  listeners.forEach((cb) => cb());
}

/** The developer's messages, the newest first, and those of them the reader has not seen yet. */
export function useNotices() {
  const me = useMe();
  const query = useQuery({
    queryKey: ['notices'],
    queryFn: () => api<Notice[]>('/notifications/notices'),
    enabled: !!me.data,
    staleTime: 5 * 60_000,
  });
  // Re-renders when a message is marked seen; the value itself is read through noticesSeenUpTo().
  useSyncExternalStore(subscribe, getSeen, () => null);
  const since = noticesSeenUpTo();
  const unread = (query.data ?? []).filter((n) => n.createdAt > since);
  return { ...query, unread };
}
