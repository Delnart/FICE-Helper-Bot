'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getWebApp } from '../lib/telegram';

interface PageHeaderProps {
  title: ReactNode;
  /** Context line under the title (date, group, discipline…). */
  subtitle?: ReactNode;
  /** Right-aligned slot: an icon button, a chip, a primary action. */
  action?: ReactNode;
  /** Status chips rendered under the title — never above it. The subtitle then follows them in the same row. */
  chips?: ReactNode;
  /** Force-show or hide Telegram's native back button. Default: shown off the tab roots. */
  back?: boolean;
}

/** Tab roots (reachable from the bottom bar). Telegram's back button is hidden there. */
const ROOT_PATHS = new Set<string>(['/', '/schedule', '/subjects', '/homework', '/profile']);

/**
 * Screen title. Per the design system nothing sits above the title, and "back"
 * is Telegram's native BackButton rather than an in-page arrow.
 */
export function PageHeader({ title, subtitle, action, chips, back }: PageHeaderProps) {
  const pathname = usePathname() ?? '/';
  const showBack = back ?? !ROOT_PATHS.has(pathname);
  useTelegramBackButton(showBack);

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="h1 break-words">{title}</h1>
        {chips ? (
          // With status chips the context line trails them in the same row (mockups 10/19/22).
          <div className="meta mt-1">
            {chips}
            {subtitle ? <span className="small muted">{subtitle}</span> : null}
          </div>
        ) : subtitle ? (
          <div className="small muted font-medium">{subtitle}</div>
        ) : null}
      </div>
      {action ? <div className="flex flex-shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** Show Telegram's native back button while mounted (navigates with router.back()). */
export function useTelegramBackButton(show = true) {
  const router = useRouter();
  useEffect(() => {
    const wa = getWebApp();
    if (!wa || !show) return;
    const onBack = () => router.back();
    try {
      wa.BackButton.onClick(onBack);
      wa.BackButton.show();
    } catch {
      return;
    }
    return () => {
      try {
        wa.BackButton.offClick(onBack);
        wa.BackButton.hide();
      } catch {
        /* older clients */
      }
    };
  }, [show, router]);
}
