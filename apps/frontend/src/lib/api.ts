import { getInitData, getWebApp } from './telegram';

function normalizeApiBase(base: string | undefined): string {
  const trimmed = (base ?? '').replace(/\/$/, '');
  if (!trimmed) return '/api';
  if (trimmed.endsWith('/api')) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? `${trimmed}/api` : trimmed;
}

export const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE);

interface AuthState {
  loaded: boolean;
  token: string | null;
  userId: string | null;
  activeGroupId: string | null;
}

const STORAGE = {
  token: 'fice_jwt',
  group: 'fice_group',
};

const state: AuthState = {
  loaded: false,
  token: null,
  userId: null,
  activeGroupId: null,
};

function telegramUserId(): string {
  return String(getWebApp()?.initDataUnsafe?.user?.id ?? '');
}

/** telegramId claim of our JWT. Not verified here — only compared with Telegram's user. */
function tokenTelegramId(token: string): string {
  try {
    return String(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).telegramId ?? '');
  } catch {
    return '';
  }
}

function loadState(): void {
  if (typeof window === 'undefined' || state.loaded) return;
  state.loaded = true;
  const ls = window.localStorage;
  state.token = ls.getItem(STORAGE.token);
  state.activeGroupId = ls.getItem(STORAGE.group);
  // A token minted for another Telegram account (shared device, account switch)
  // must never be reused — it would show that person's groups and roles.
  // The cached group is re-validated against memberships by Shell.
  const tgUser = telegramUserId();
  if (state.token && tgUser && tokenTelegramId(state.token) !== tgUser) dropToken(state.token);
}

function dropToken(token: string | null): void {
  // Another request may already have re-logged in; keep the fresh token.
  if (state.token !== token) return;
  state.token = null;
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE.token);
}

// The active group lives outside React; components subscribe to it via
// useActiveGroup() so role-dependent UI re-renders the moment it changes.
const groupListeners = new Set<() => void>();

export function subscribeActiveGroup(cb: () => void): () => void {
  groupListeners.add(cb);
  return () => groupListeners.delete(cb);
}

export function setActiveGroup(groupId: string | null): void {
  loadState();
  if (state.activeGroupId === groupId) return;
  state.activeGroupId = groupId;
  if (typeof window !== 'undefined') {
    if (groupId) window.localStorage.setItem(STORAGE.group, groupId);
    else window.localStorage.removeItem(STORAGE.group);
  }
  groupListeners.forEach((cb) => cb());
}

export function getActiveGroup(): string | null {
  loadState();
  return state.activeGroupId;
}

export function getToken(): string | null {
  loadState();
  return state.token;
}

let loginPromise: Promise<{ token: string; userId: string }> | null = null;

export async function loginWithTelegram(): Promise<{ token: string; userId: string }> {
  if (loginPromise) return loginPromise;
  // Concurrent callers share the in-flight login; once it settles the next
  // caller (e.g. a 401 replay) must start a fresh one, not reuse a stale token.
  loginPromise = _doLogin().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

async function _doLogin(): Promise<{ token: string; userId: string }> {
  const initData = getInitData();
  if (!initData) throw new Error('Telegram WebApp initData недоступна. Відкрийте цей застосунок через бот.');
  const res = await fetchWithTimeout(`${API_BASE}/auth/telegram`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`Auth failed: ${res.status} ${text}`, res.status);
  }
  const data = (await res.json()) as { token: string; user: { id: string; memberships?: Array<{ groupId: string }> } };
  state.token = data.token;
  state.userId = data.user.id;
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE.token, data.token);
  // Single group → select it before the first page query goes out. A stored
  // group is left alone: teachers open groups they aren't members of, and a
  // silent re-login after a 401 must not reset that. Shell validates the rest.
  const ids = (data.user.memberships ?? []).map((m) => String(m.groupId));
  if (!state.activeGroupId && ids.length === 1) setActiveGroup(ids[0]);
  return { token: data.token, userId: data.user.id };
}

/** Error carrying the HTTP status, so callers (and React Query's retry) can tell 4xx from outages. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * fetch with a timeout: a request hung on the slow server otherwise blocks
 * every refetch of its query key (React Query reuses the in-flight promise).
 * Plain AbortController — older iOS Telegram WebViews lack AbortSignal.timeout.
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 15_000): Promise<Response> {
  const ctl = new AbortController();
  init.signal?.addEventListener('abort', () => ctl.abort());
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    if (ctl.signal.aborted && !init.signal?.aborted) throw new ApiError('Сервер не відповідає. Спробуйте ще раз.', 408);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function api<T>(path: string, options: ApiOptions = {}, isRetry = false): Promise<T> {
  loadState();
  if (!state.token) await loginWithTelegram();
  const usedToken = state.token;
  if (!usedToken) throw new ApiError('Не вдалося авторизуватися. Перезапустіть застосунок.', 401);
  const url = new URL(`${API_BASE}${path}`, typeof window === 'undefined' ? 'http://local' : window.location.origin);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  // Bypass ngrok-free's "browser warning" interstitial — without this header
  // the tunnel returns HTML on the first hit per session, which fails to parse
  // as JSON and leaves Mini App requests pending forever.
  headers.set('ngrok-skip-browser-warning', 'true');
  if (state.token) headers.set('authorization', `Bearer ${state.token}`);
  if (state.activeGroupId) headers.set('x-group-id', state.activeGroupId);

  const res = await fetchWithTimeout(url.toString(), {
    ...options,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  if (res.status === 401) {
    // Expired / revoked JWT: silently re-login with initData and replay once.
    // The active group is kept — wiping it used to reset multi-group users.
    dropToken(usedToken);
    if (!isRetry) return api<T>(path, options, true);
    throw new ApiError('Сесія застаріла. Перезапустіть застосунок.', 401);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = Array.isArray(body.message) ? body.message.join(', ') : String(body.message);
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  // Nest answers void handlers (e.g. swap respond) with an empty 200/201 and
  // no content-type — that's success, not a parse error.
  const text = await res.text();
  if (!text) return undefined as T;
  // Defensive: if the tunnel ever returns HTML (interstitial slipped through)
  // we'd otherwise fail to parse it. Detect content-type first.
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new Error(`Очікували JSON, отримали ${ct || 'невідомий тип'}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}
