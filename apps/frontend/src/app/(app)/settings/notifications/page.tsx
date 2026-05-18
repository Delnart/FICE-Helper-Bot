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

// Module-level constant so the queryKey reference is stable across renders.
// React Query compares keys by deep equality, but reusing the same array also
// rules out any subtle drift between renders.
const PREFS_QUERY_KEY = ['prefs'] as const;

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: PREFS_QUERY_KEY,
    queryFn: () => api<Prefs>('/notifications/prefs'),
  });

  /**
   * Optimistic update + final refetch:
   *   • onMutate: patch the cache locally — toggle flips instantly.
   *   • onError: rollback to the snapshot.
   *   • onSettled (success OR error): invalidate so the next render reads
   *     the *server's* authoritative state. We deliberately don't write the
   *     server response into the cache from `onSuccess` anymore — earlier
   *     attempts showed that if the JSON came back partial (e.g. a Mongoose
   *     doc serialised without one of the boolean defaults), every key it
   *     omitted read as `undefined` → `Boolean(undefined)` → all toggles
   *     visually flip off. Invalidate-then-refetch is the safe path.
   */
  const save = useMutation({
    mutationFn: (p: Partial<Prefs>) =>
      api<Prefs>('/notifications/prefs', { method: 'PATCH', json: p }),
    onMutate: async (partial) => {
      // Stop any in-flight GET so it can't overwrite the optimistic update.
      await qc.cancelQueries({ queryKey: PREFS_QUERY_KEY });
      const prev = qc.getQueryData<Prefs>(PREFS_QUERY_KEY);
      if (prev) qc.setQueryData<Prefs>(PREFS_QUERY_KEY, { ...prev, ...partial });
      return { prev };
    },
    onSuccess: () => haptic('selection'),
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData<Prefs>(PREFS_QUERY_KEY, ctx.prev);
      haptic('error');
    },
    onSettled: () => {
      // Pull fresh truth from the server now that the mutation finished.
      // This is the ONE invalidate we do — keeps the cache in sync without
      // racing the in-flight write (cancelled in onMutate above).
      void qc.invalidateQueries({ queryKey: PREFS_QUERY_KEY });
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
