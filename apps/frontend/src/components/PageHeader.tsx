'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Force-show or hide the back button. By default, shown on every non-root page (root = bottom-bar tabs). */
  back?: boolean;
}

/** Top-level routes reachable from the bottom navigation. No back button on these. */
const ROOT_PATHS = new Set<string>(['/', '/schedule', '/attendance', '/profile']);

export function PageHeader({ title, subtitle, action, back }: PageHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const showBack = back ?? !ROOT_PATHS.has(pathname);

  return (
    <header className="flex items-start gap-3 mb-4">
      {showBack ? (
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Назад"
          className="h-9 w-9 -ml-1 rounded-full bg-paper-200 text-ink-700 hover:bg-paper-300 flex items-center justify-center flex-shrink-0 active:scale-95 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
      <div className="flex-1 min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight truncate">{title}</h1>
        {subtitle ? <p className="text-[14px] text-ink-500 mt-1">{subtitle}</p> : null}
      </div>
      {action ? <div className="pt-0.5 flex-shrink-0">{action}</div> : null}
    </header>
  );
}
