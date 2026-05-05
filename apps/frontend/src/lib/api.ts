import { getInitData } from './telegram';

function normalizeApiBase(base: string | undefined): string {
  const trimmed = (base ?? '').replace(/\/$/, '');
  if (!trimmed) return '/api';
  if (trimmed.endsWith('/api')) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? `${trimmed}/api` : trimmed;
}

export const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE);

interface AuthState {
  token: string | null;
  userId: string | null;
  activeGroupId: string | null;
}

const STORAGE = {
  token: 'fice_jwt',
  group: 'fice_group',
};

let state: AuthState = {
  token: null,
  userId: null,
  activeGroupId: null,
};

function loadState(): void {
  if (typeof window === 'undefined') return;
  if (state.token) return;
  state.token = window.localStorage.getItem(STORAGE.token);
  state.activeGroupId = window.localStorage.getItem(STORAGE.group);
}

export function setActiveGroup(groupId: string | null): void {
  state.activeGroupId = groupId;
  if (typeof window === 'undefined') return;
  if (groupId) window.localStorage.setItem(STORAGE.group, groupId);
  else window.localStorage.removeItem(STORAGE.group);
}

export function getActiveGroup(): string | null {
  loadState();
  return state.activeGroupId;
}

export function getToken(): string | null {
  loadState();
  return state.token;
}

export function clearAuth(): void {
  state = { token: null, userId: null, activeGroupId: null };
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE.token);
  window.localStorage.removeItem(STORAGE.group);
}

export async function loginWithTelegram(): Promise<{ token: string; userId: string }> {
  const initData = getInitData();
  if (!initData) throw new Error('Telegram WebApp initData недоступна. Відкрийте цей застосунок через бот.');
  const res = await fetch(`${API_BASE}/auth/telegram`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { token: string; userId: string; memberships?: Array<{ groupId: string }> };
  state.token = data.token;
  state.userId = data.userId;
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE.token, data.token);
  if (!state.activeGroupId && data.memberships && data.memberships[0]) {
    setActiveGroup(data.memberships[0].groupId);
  }
  return { token: data.token, userId: data.userId };
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  loadState();
  if (!state.token) await loginWithTelegram();
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

  const res = await fetch(url.toString(), {
    ...options,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });

  if (res.status === 401) {
    clearAuth();
    throw new Error('Сесія застаріла. Перезапустіть застосунок.');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = Array.isArray(body.message) ? body.message.join(', ') : String(body.message);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  // Defensive: if the tunnel ever returns HTML (interstitial slipped through)
  // we'd otherwise hang on res.json(). Detect content-type first.
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const txt = (await res.text()).slice(0, 200);
    throw new Error(`Очікували JSON, отримали ${ct || 'невідомий тип'}: ${txt}`);
  }
  return (await res.json()) as T;
}
