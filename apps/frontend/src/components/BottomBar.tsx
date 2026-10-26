'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/cn';
import { api } from '../lib/api';
import { haptic } from '../lib/telegram';
import { useIsTeacherOnly, useMe } from '../hooks/useMe';
import { Icon, type IconName } from './icons';

interface NavItem {
  href: Route;
  label: string;
  icon: IconName;
  /** Other route prefixes that highlight this tab. */
  also?: string[];
  badge?: 'homework';
}

const STUDENT_ITEMS: NavItem[] = [
  { href: '/' as Route, label: 'Сьогодні', icon: 'home', also: ['/attendance'] },
  { href: '/schedule' as Route, label: 'Розклад', icon: 'calendar' },
  { href: '/subjects' as Route, label: 'Предмети', icon: 'book', also: ['/queues'] },
  { href: '/homework' as Route, label: 'Завдання', icon: 'task', badge: 'homework' },
  { href: '/profile' as Route, label: 'Профіль', icon: 'user', also: ['/settings'] },
];

const TEACHER_ITEMS: NavItem[] = [
  { href: '/' as Route, label: 'Дисципліни', icon: 'book', also: ['/subjects', '/queues'] },
  { href: '/schedule' as Route, label: 'Розклад', icon: 'calendar' },
  { href: '/profile' as Route, label: 'Профіль', icon: 'user', also: ['/settings'] },
];

/** Focused flows with their own sticky action bar — no tab bar there. */
const HIDDEN = [
  /^\/select-group/,
  /^\/attendance\/mark/,
  /^\/subjects\/new/,
  /^\/subjects\/[^/]+\/edit/,
  /^\/homework\/new/,
  /^\/homework\/[^/]+\/edit/,
];

export function isTabBarHidden(path: string): boolean {
  return HIDDEN.some((re) => re.test(path));
}

function isActive(it: NavItem, path: string): boolean {
  const prefixes = [it.href as string, ...(it.also ?? [])];
  return prefixes.some((p) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`)));
}

export function BottomBar() {
  const path = usePathname() ?? '/';
  const me = useMe();
  const isTeacher = useIsTeacherOnly();
  // Same query (and cache) as Home's "завдання" tile, so the badge and the tile always agree.
  const hw = useQuery({
    queryKey: ['hw-pending-count'],
    queryFn: () => api<unknown[]>('/homework/my/pending'),
    enabled: !!me.data && !isTeacher,
  });
  if (isTabBarHidden(path)) return null;

  const pending = hw.data?.length ?? 0;
  const items = isTeacher ? TEACHER_ITEMS : STUDENT_ITEMS;

  return (
    <nav className="tabbar fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl" aria-label="Основна навігація">
      {items.map((it) => {
        const active = isActive(it, path);
        const count = it.badge === 'homework' ? pending : 0;
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={() => haptic('selection')}
            aria-current={active ? 'page' : undefined}
            className={cn('tab', active && 'on')}
          >
            <span className="tab-ic">
              <Icon name={it.icon} size={22} strokeWidth={1.9} />
              {count > 0 ? (
                <span className="count absolute -top-0.5 right-0.5 h-[18px] min-w-[18px] text-[11px]">
                  {count > 9 ? '9+' : count}
                </span>
              ) : null}
            </span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
