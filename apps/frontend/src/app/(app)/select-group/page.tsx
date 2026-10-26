'use client';

import { useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { setActiveGroup } from '../../../lib/api';
import { useActiveGroup, useMe } from '../../../hooks/useMe';
import { useTelegramBackButton } from '../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Icon, Logo } from '../../../components/icons';
import { haptic } from '../../../lib/telegram';
import { cn } from '../../../lib/cn';

export default function SelectGroupPage() {
  useTelegramBackButton();
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  const active = useActiveGroup();
  const [selected, setSelected] = useState<string | null>(null);
  const next = params.get('next') || '/';

  function pick(groupId: string) {
    // setActiveGroup notifies Providers, which refetches every group-scoped query.
    setActiveGroup(groupId);
    haptic('selection');
    router.replace(next as Route);
  }

  const memberships = me.data?.memberships ?? [];
  const chosenId = selected ?? active;
  const chosen = memberships.find((m) => m.groupId === chosenId);

  return (
    <div className="flex min-h-[calc(100dvh-42px)] flex-col gap-5 pt-2.5">
      <header className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5">
          <Logo size={36} className="block flex-shrink-0 rounded-[10px]" />
          <span className="eyebrow text-ink-2">FICE Helper</span>
        </div>
        <h1 className="h1 text-[24px]">Оберіть активну групу</h1>
        <p className="leading-normal text-ink-2">
          Ви входите до кількох груп. Активна група визначає розклад, черги, завдання та сповіщення. Змінити її
          можна будь-коли в профілі.
        </p>
      </header>

      {me.isLoading ? (
        <Loading />
      ) : me.isError && !me.data ? (
        <ErrorState title="Не вдалося завантажити групи" error={me.error} onRetry={() => me.refetch()} />
      ) : memberships.length ? (
        <>
          <section role="radiogroup" aria-label="Групи" className="flex flex-col gap-2.5">
            {memberships.map((m) => {
              const on = chosenId === m.groupId;
              return (
                <button
                  key={m.groupId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setSelected(m.groupId);
                    haptic('selection');
                  }}
                  className={cn(
                    'card-flat flex w-full items-center gap-3.5 text-left',
                    on && 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]',
                  )}
                >
                  <span className={cn('radio', on && 'on')} aria-hidden="true" />
                  <span className={cn('subj', on && 'subj-ink')}>
                    <Icon name="users" strokeWidth={1.9} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="h3 text-[16px]">{m.groupName ?? m.groupId}</span>
                    {active === m.groupId ? <span className="tiny faint">Активна зараз</span> : null}
                  </div>
                  <span className={cn('chip', roleChip(m.role))}>{roleLabel(m.role)}</span>
                </button>
              );
            })}
          </section>

          <div className="action-bar mt-auto flex-col items-stretch">
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!chosen}
              onClick={() => chosen && pick(chosen.groupId)}
            >
              {chosen ? `Продовжити як ${chosen.groupName ?? chosen.groupId}` : 'Оберіть групу'}
            </button>
            <span className="tiny faint text-center">Якщо група одна — цей екран не показується.</span>
          </div>
        </>
      ) : (
        <Empty
          icon="users"
          title="Ви ще не в жодній групі"
          hint="Додайте бота до групового чату та виконайте /bind, або попросіть старосту додати вас."
        />
      )}
    </div>
  );
}

function roleLabel(r: string): string {
  const m: Record<string, string> = {
    Student: 'Студент',
    Teacher: 'Викладач',
    DeputyHead: 'Заступник старости',
    GroupHead: 'Староста',
    Admin: 'Адмін',
    student: 'Студент',
    teacher: 'Викладач',
    deputy_head: 'Заступник старости',
    group_head: 'Староста',
    admin: 'Адмін',
  };
  return m[r] ?? r;
}

function roleChip(r: string): string {
  switch (r.toLowerCase()) {
    case 'grouphead':
    case 'group_head':
    case 'deputyhead':
    case 'deputy_head':
      return 'chip-accent';
    case 'teacher':
      return 'chip-info';
    case 'admin':
      return 'chip-ink';
    default:
      return '';
  }
}
