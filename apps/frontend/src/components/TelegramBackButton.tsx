'use client';

import { useTelegramBackButton } from './PageHeader';

/**
 * Telegram's native back button for server-rendered pages outside the Shell
 * (/privacy). Outside a Mini App the hook does nothing visible.
 */
export function TelegramBackButton() {
  useTelegramBackButton();
  return null;
}
