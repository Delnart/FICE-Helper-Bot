'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { haptic } from '../../../../lib/telegram';
import { cn } from '../../../../lib/cn';

interface Prefs {
  dmQueueOpen: boolean;
  dmNextInQueue: boolean;
  dmDeadlineTomorrow: boolean;
  dmSwapRequests: boolean;
}

const LABELS: Array<{ k: keyof Prefs; title: string; hint: string }> = [
  { k: 'dmQueueOpen', title: 'Відкриття черги', hint: 'Сповіщати у ЛС за 5 хв до відкриття' },
  { k: 'dmNextInQueue', title: 'Ви наступний у черзі', hint: 'Коли попередній почав здавати' },
  { k: 'dmDeadlineTomorrow', title: 'Дедлайн завтра', hint: 'Ранкове нагадування о 9:00' },
  { k: 'dmSwapRequests', title: 'Запити на обмін', hint: 'Коли хтось пропонує обмін у черзі' },
];

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();
  const queryKey = ['prefs'];
  const { data } = useQuery({ queryKey, queryFn: () => api<Prefs>('/notifications/prefs') });

  /**
   * Optimistic update via React Query's onMutate pattern.
   * Why: previously every toggle triggered an invalidate → refetch round-trip,
   * which (a) was visually laggy and (b) raced — toggling two switches in a row
   * meant the second mutation's refetch sometimes returned stale data and
   * "un-toggled" the first one. Now:
   *   1. onMutate: patch the cache locally — toggle flips instantly.
   *   2. mutationFn: send PATCH in background; backend response writes back to cache.
   *   3. onError: rollback to the snapshot taken in onMutate.
   * We DO NOT invalidate on success — the response is the source of truth.
   */
  const save = useMutation({
    mutationFn: (p: Partial<Prefs>) =>
      api<Prefs>('/notifications/prefs', { method: 'PATCH', json: p }),
    onMutate: async (partial) => {
      // Cancel any in-flight refetch so it can't overwrite our optimistic update.
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Prefs>(queryKey);
      if (prev) qc.setQueryData<Prefs>(queryKey, { ...prev, ...partial });
      return { prev };
    },
    onSuccess: (server) => {
      // Server's authoritative response replaces our optimistic guess.
      qc.setQueryData<Prefs>(queryKey, server);
      haptic('selection');
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData<Prefs>(queryKey, ctx.prev);
      haptic('error');
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Сповіщення" subtitle="Керуйте тим, що приходить вам у ЛС" />
      <div className="card divide-y divide-paper-300">
        {LABELS.map((l, i) => (
          <Row
            key={l.k}
            title={l.title}
            hint={l.hint}
            checked={Boolean(data?.[l.k])}
            onChange={(v) => save.mutate({ [l.k]: v } as Partial<Prefs>)}
            first={i === 0}
            last={i === LABELS.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  title,
  hint,
  checked,
  onChange,
  first,
  last,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-3', first && 'pt-0', last && 'pb-0')}>
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-ink-500">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 rounded-full transition-colors',
        checked ? 'bg-ink-900' : 'bg-paper-300',
      )}
      aria-pressed={checked}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-paper-50 shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}
