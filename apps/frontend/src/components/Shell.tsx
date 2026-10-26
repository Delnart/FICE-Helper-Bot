'use client';

import type { ReactNode } from 'react';
import type { Route } from 'next';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BottomBar, isTabBarHidden } from './BottomBar';
import { Loading } from './Empty';
import { Icon, Logo } from './icons';
import { useAuth } from '../hooks/useAuth';
import { useActiveGroup, useIsTeacherOnly, useMe } from '../hooks/useMe';
import { setActiveGroup } from '../lib/api';
import { cn } from '../lib/cn';
import { vocative } from '../lib/name';
import { getWebApp, haptic } from '../lib/telegram';

export function Shell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const me = useMe();
  const active = useActiveGroup();
  const isTeacherOnly = useIsTeacherOnly();
  const memberIds = me.data?.memberships.map((m) => m.groupId) ?? [];

  useEffect(() => {
    if (!me.data) return;
    // Teachers have their own group selection on the home page — skip this flow.
    if (isTeacherOnly) return;
    const ids = me.data.memberships.map((m) => m.groupId);
    // Keep a valid choice, auto-select a single group, otherwise ask. localStorage
    // is per-browser, so a cached id from another account / a group the user
    // left is dropped here. One setActiveGroup call → one refetch round.
    const next = active && ids.includes(active) ? active : ids.length === 1 ? ids[0] : null;
    if (next !== active) setActiveGroup(next);
    if (!next && ids.length > 1 && pathname !== '/select-group') {
      router.replace(`/select-group?next=${encodeURIComponent(pathname)}` as Route);
    }
  }, [me.data, isTeacherOnly, active, pathname, router]);

  const noAccess = !!me.data && me.data.accessReason === 'none';
  // Pages render only once the profile and the active group are known: their
  // queries carry the group in the x-group-id header, and anything fetched
  // before that came back empty / 400 and looked like "nothing loads".
  const groupReady =
    !!me.data &&
    (isTeacherOnly ||
      memberIds.length === 0 ||
      (!!active && memberIds.includes(active)) ||
      pathname === '/select-group');
  const ready = auth.ready && !auth.error && !noAccess && groupReady;
  // A teacher not yet linked to Кампус sees the onboarding on "/" — no tab bar there (mockup 20).
  const teacherOnboarding = isTeacherOnly && !me.data?.campusLecturerId && pathname === '/';
  const showTabBar = ready && !isTabBarHidden(pathname) && !teacherOnboarding;

  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <main
        className={cn(
          'mx-auto max-w-xl px-4 pt-[18px]',
          showTabBar ? 'pb-[calc(var(--safe-bottom)+104px)]' : 'pb-6',
        )}
      >
        {!auth.ready ? (
          <Loading label="Авторизація…" />
        ) : auth.error ? (
          <div className="card-flat flex flex-col items-start gap-3 border-bad">
            <div className="flex flex-col gap-1">
              <div className="h3 text-bad">Помилка авторизації</div>
              <div className="small muted">{auth.error}</div>
            </div>
            <button type="button" className="btn btn-secondary btn-md" onClick={auth.retry}>
              Спробувати ще раз
            </button>
          </div>
        ) : me.isError && !me.data ? (
          <div className="card-flat flex flex-col items-start gap-3">
            <div className="flex flex-col gap-1">
              <div className="h3">Не вдалося завантажити профіль</div>
              <div className="small muted">{(me.error as Error).message}</div>
            </div>
            <button type="button" className="btn btn-secondary btn-md" onClick={() => me.refetch()} disabled={me.isFetching}>
              {me.isFetching ? 'Пробую…' : 'Спробувати ще раз'}
            </button>
          </div>
        ) : noAccess ? (
          <NoAccessScreen
            firstName={me.data?.firstName}
            botUsername={me.data?.botUsername}
            onRetry={() => me.refetch()}
            retrying={me.isFetching}
          />
        ) : !ready ? (
          <Loading />
        ) : (
          children
        )}
      </main>
      {showTabBar ? <BottomBar /> : null}
    </div>
  );
}

// Step 1 names the bot by @username when /users/me knows it, so the head can find it in search.
const steps = (botUsername?: string): Array<{ title: string; body: ReactNode; command?: string }> => [
  {
    title: 'Староста додає бота в чат групи',
    body: (
      <>
        Попросіть старосту додати {botUsername ? null : 'бота '}
        <span className="font-semibold text-ink">{botUsername ? `@${botUsername}` : 'FICE Helper'}</span> у
        груповий чат.
      </>
    ),
  },
  {
    title: 'Виконує команду в чаті',
    command: '/verify',
    body: 'Бот знайде групу в Кампус КПІ та підтягне розклад.',
  },
  {
    title: 'Напишіть будь-що в чаті',
    body: 'Після цього застосунок відкриється сам — перезапускати нічого не треба.',
  },
];

function NoAccessScreen({
  firstName,
  botUsername,
  onRetry,
  retrying,
}: {
  firstName?: string;
  botUsername?: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-42px)] flex-col gap-[18px] pt-2.5">
      <header className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="eyebrow text-ink-2">FICE Helper</span>
        </div>
        <h1 className="h1 text-[24px]">
          {firstName ? `Привіт, ${vocative(firstName)}! ` : 'Привіт! '}Вашої групи тут ще немає
        </h1>
        <p className="leading-normal text-ink-2">
          Застосунок працює для груп, які підключив староста. Це займає хвилину — ось що потрібно зробити.
        </p>
      </header>

      <section aria-label="Кроки підключення" className="flex flex-col gap-2.5">
        {steps(botUsername).map((s, i) => (
          <div key={s.title} className="card-flat flex items-start gap-3.5">
            <span className="num w-8 flex-shrink-0 text-[26px] leading-none text-accent-text">{i + 1}</span>
            <div className={cn('flex flex-col', s.command ? 'gap-1.5' : 'gap-1')}>
              <span className="h3 text-[16px]">{s.title}</span>
              {s.command ? <span className="chip h-7 self-start font-mono">{s.command}</span> : null}
              <span className="small muted">{s.body}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="card-soft flex flex-col gap-2.5">
        <span className="h3">Ви староста або викладач, і вас не пускає?</span>
        <span className="small muted">
          Вашого тегу ще немає в адміністративній таблиці. Напишіть у підтримку — адміни додадуть вас і одразу
          відкриють доступ.
        </span>
      </section>

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => {
            haptic('light');
            // The bot chat, where /support reaches the admins; without its name, close back to Telegram.
            if (botUsername) getWebApp()?.openTelegramLink(`https://t.me/${botUsername}`);
            else getWebApp()?.close();
          }}
        >
          <Icon name="send" size={18} />
          Написати в підтримку
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Перевіряю…' : 'Перевірити доступ ще раз'}
        </button>
      </div>
    </div>
  );
}
