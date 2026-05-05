'use client';

import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveGroup, setActiveGroup } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { haptic } from '../../../lib/telegram';

interface GroupRow {
  groupId: string;
  role: string;
  groupName?: string;
}

interface MeDto {
  _id: string;
  memberships: GroupRow[];
}

export default function SelectGroupPage() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/users/me') });
  const active = getActiveGroup();
  const next = params.get('next') || '/';

  function pick(groupId: string) {
    setActiveGroup(groupId);
    haptic('selection');
    qc.invalidateQueries();
    router.replace(next as Route);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Оберіть групу" subtitle="Ви входите до кількох груп. Виберіть активну." />

      {me.isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : me.data && me.data.memberships.length ? (
        <div className="space-y-2">
          {me.data.memberships.map((m) => (
            <button
              key={m.groupId}
              onClick={() => pick(m.groupId)}
              className={
                'card flex items-center justify-between hover:bg-paper-100 w-full text-left ' +
                (active === m.groupId ? 'border-ink-900' : '')
              }
            >
              <div>
                <div className="font-medium">{m.groupName ?? m.groupId}</div>
                <div className="text-sm text-ink-500 mt-0.5">{roleLabel(m.role)}</div>
              </div>
              {active === m.groupId ? (
                <span className="chip bg-ink-900 text-paper-50">Активна</span>
              ) : (
                <span className="chip">Обрати</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="font-semibold mb-1">Ви ще не в жодній групі</div>
          <div className="text-sm text-ink-500">
            Додайте бота до групового чату та виконайте /bind, або попросіть старосту додати вас.
          </div>
        </div>
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
