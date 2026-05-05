'use client';

import type { ReactNode } from 'react';
import type { Route } from 'next';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BottomBar } from './BottomBar';
import { useAuth } from '../hooks/useAuth';
import { useIsTeacherOnly } from '../hooks/useMe';
import { api, getActiveGroup, setActiveGroup } from '../lib/api';

interface MeDto {
  firstName?: string;
  fullName?: string;
  username?: string;
  memberships: Array<{ groupId: string; groupName?: string; role: string }>;
  accessReason?: 'member' | 'teacher' | 'none';
}

export function Shell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isTeacherOnly = useIsTeacherOnly();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeDto>('/users/me'),
    enabled: auth.ready && !auth.error,
  });

  useEffect(() => {
    if (!me.data) return;
    // Teachers have their own group selection on the home page — skip this flow.
    if (isTeacherOnly) return;
    const active = getActiveGroup();
    const memberIds = me.data.memberships.map((m) => m.groupId);
    const count = memberIds.length;
    // localStorage is per-browser, so an `activeGroupId` from a previous
    // logged-in account can leak through. If the cached id isn't in this
    // user's memberships → drop it before evaluating auto-select / redirect.
    let effectiveActive = active;
    if (active && !memberIds.includes(active)) {
      setActiveGroup(null);
      effectiveActive = null;
    }
    // Exactly one group → auto-select
    if (count === 1 && effectiveActive !== memberIds[0]) {
      setActiveGroup(memberIds[0]);
      return;
    }
    // Multiple groups, none chosen → prompt
    if (count > 1 && !effectiveActive && pathname !== '/select-group') {
      router.replace(`/select-group?next=${encodeURIComponent(pathname || '/')}` as Route);
    }
  }, [me.data, isTeacherOnly, pathname, router]);

  const noAccess =
    auth.ready && !auth.error && me.data && me.data.accessReason === 'none';

  return (
    <div className="min-h-[100dvh] bg-paper-100 text-ink-900">
      <main className="mx-auto max-w-xl px-4 pt-5 app-scroll">
        {!auth.ready ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-500">
            <div className="h-8 w-8 rounded-full border-2 border-paper-300 border-t-ink-900 animate-spin" />
            <div className="mt-3 text-sm">Авторизація…</div>
          </div>
        ) : auth.error ? (
          <div className="card border-danger/40 text-danger">
            <div className="font-semibold mb-1">Помилка авторизації</div>
            <div className="text-sm opacity-80">{auth.error}</div>
          </div>
        ) : noAccess ? (
          <NoAccessScreen firstName={me.data?.firstName} fullName={me.data?.fullName} />
        ) : (
          children
        )}
      </main>
      {auth.ready && !auth.error && !noAccess ? <BottomBar /> : null}
    </div>
  );
}

function NoAccessScreen({ firstName }: { firstName?: string; fullName?: string }) {
  return (
    <div className="space-y-4 py-6">
      <div className="card space-y-3">
        <div className="text-[20px] font-semibold leading-tight">
          {firstName ? `Вітаю, ${firstName}!` : 'Вітаю!'}
        </div>
        <div className="text-sm text-ink-700 leading-relaxed">
          У нашій базі поки немає вашої академічної групи. Щоб користуватись застосунком,
          попросіть старосту вашої групи додати бота{' '}
          <span className="font-semibold">FICE Helper</span> у груповий чат і виконати команду{' '}
          <code className="px-1 py-0.5 rounded bg-paper-200">/verify</code>.
        </div>
      </div>

      <div className="card text-sm text-ink-500">
        Коли староста привʼяже чат і ви напишете в ньому будь-яке повідомлення — застосунок одразу
        запрацює. Перезапускати нічого не потрібно.
      </div>

      <div className="card space-y-2">
        <div className="font-semibold text-sm">Староста або викладач і вас не пускає?</div>
        <div className="text-sm text-ink-700 leading-relaxed">
          Це означає, що вашого тегу ще немає в адміністративній таблиці.
          Напишіть боту команду{' '}
          <code className="px-1 py-0.5 rounded bg-paper-200">/support</code>{' '}
          або натисніть «📨 Підтримка» в чаті з ботом — адміни додадуть вас і зразу
          відкриють доступ.
        </div>
      </div>
    </div>
  );
}
