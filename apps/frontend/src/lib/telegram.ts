export type TelegramThemeParams = Record<string, string | undefined>;

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: {
    show(): void;
    hide(): void;
    setText(t: string): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
  };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent?(event: 'themeChanged' | 'activated' | 'deactivated', cb: () => void): void;
  offEvent?(event: 'themeChanged' | 'activated' | 'deactivated', cb: () => void): void;
  ready(): void;
  expand(): void;
  close(): void;
  openTelegramLink(url: string): void;
  showAlert(msg: string, cb?: () => void): void;
  showConfirm(msg: string, cb: (ok: boolean) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

export function getInitData(): string {
  const wa = getWebApp();
  if (wa && wa.initData) return wa.initData;
  if (typeof window === 'undefined') return '';
  const devInitData = window.localStorage.getItem('fice_dev_init_data');
  return devInitData ?? '';
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'error' | 'selection'): void {
  const wa = getWebApp();
  if (!wa) return;
  try {
    if (kind === 'success') wa.HapticFeedback.notificationOccurred('success');
    else if (kind === 'error') wa.HapticFeedback.notificationOccurred('error');
    else if (kind === 'selection') wa.HapticFeedback.selectionChanged();
    else wa.HapticFeedback.impactOccurred(kind);
  } catch {
    /* ignore */
  }
}

/**
 * Mirror Telegram's color scheme onto `html.dark` and paint Telegram's own
 * header/background in the app's `--bg`. Returns an unsubscribe function.
 * Outside Telegram (platform "unknown") follows the OS preference.
 */
export function syncTheme(): () => void {
  const wa = getWebApp();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const inTelegram = !!wa && wa.platform !== 'unknown';
  const apply = () => {
    const dark = inTelegram ? wa!.colorScheme === 'dark' : media.matches;
    document.documentElement.classList.toggle('dark', dark);
    if (!inTelegram) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    try {
      wa!.setHeaderColor?.(bg);
      wa!.setBackgroundColor?.(bg);
      wa!.setBottomBarColor?.(bg);
    } catch {
      /* older clients */
    }
  };
  apply();
  if (inTelegram) {
    wa!.onEvent?.('themeChanged', apply);
    return () => wa!.offEvent?.('themeChanged', apply);
  }
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}
