'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/cn';
import { haptic } from '../lib/telegram';
import { useCanManage, useIsTeacherOnly } from '../hooks/useMe';

interface NavItem {
  href: Route;
  label: string;
  icon: (p: { className?: string }) => JSX.Element;
  managerOnly?: boolean;
}

const STUDENT_ITEMS: NavItem[] = [
  { href: '/' as Route, label: 'Головна', icon: HomeIcon },
  { href: '/schedule' as Route, label: 'Розклад', icon: CalendarIcon },
  { href: '/attendance' as Route, label: 'Журнал', icon: ListIcon, managerOnly: true },
  { href: '/profile' as Route, label: 'Профіль', icon: UserIcon },
];

const TEACHER_ITEMS: NavItem[] = [
  { href: '/' as Route, label: 'Мої групи', icon: BuildingIcon },
  { href: '/schedule' as Route, label: 'Розклад', icon: CalendarIcon },
  { href: '/profile' as Route, label: 'Профіль', icon: UserIcon },
];

export function BottomBar() {
  const path = usePathname();
  const canManage = useCanManage();
  const isTeacher = useIsTeacherOnly();

  const items = isTeacher
    ? TEACHER_ITEMS
    : STUDENT_ITEMS.filter((it) => !it.managerOnly || canManage);
  return (
    <nav
      className={cn(
        'fixed left-0 right-0 bottom-0 z-40',
        'mx-auto max-w-xl',
        'bottom-bar-safe px-3',
      )}
    >
      <div className="rounded-3xl bg-paper-50/95 backdrop-blur border border-paper-300 shadow-bar flex items-stretch justify-between px-2 py-1.5">
        {items.map((it) => {
          const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => haptic('selection')}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 transition-colors',
                active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-700',
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'text-zinc-900')} />
              <span className={cn('text-[11px] font-medium', active && 'text-zinc-900')}>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function HomeIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" strokeLinejoin="round" />
    </svg>
  );
}
function CalendarIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function ListIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M8 6h13M8 12h13M8 18h13" strokeLinecap="round" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" />
    </svg>
  );
}
function UserIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" strokeLinecap="round" />
    </svg>
  );
}
function BuildingIcon(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 21V9h6v12M3 9h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
