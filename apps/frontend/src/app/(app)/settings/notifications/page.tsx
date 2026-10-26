'use client';

import { Fragment } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { Section } from '../../../../components/ui/Section';
import { Toggle } from '../../../../components/ui/Toggle';
import { ErrorState, Loading } from '../../../../components/Empty';
import { Icon } from '../../../../components/icons';
import { haptic } from '../../../../lib/telegram';
import { useActiveGroup } from '../../../../hooks/useMe';

interface Prefs {
  dmQueueOpen: boolean;
  dmNextInQueue: boolean;
  dmDeadlineTomorrow: boolean;
  dmSwapRequests: boolean;
  dmMorningDigest: boolean;
  dmLessonReminder: boolean;
}

const GROUPS: Array<{ title: string; items: Array<{ k: keyof Prefs; title: string; hint: string }> }> = [
  {
    title: 'Черги',
    items: [
      { k: 'dmQueueOpen', title: 'Відкриття черги', hint: 'За 5 хв до відкриття — встигнете записатись' },
      { k: 'dmNextInQueue', title: 'Ви наступний', hint: 'Коли попередній почав здавати' },
      { k: 'dmSwapRequests', title: 'Запити на обмін', hint: 'Коли хтось пропонує помінятись місцями' },
    ],
  },
  {
    title: 'Завдання',
    items: [
      { k: 'dmDeadlineTomorrow', title: 'Дедлайн завтра', hint: 'Зранку о 9:00, лише невиконані' },
      { k: 'dmMorningDigest', title: 'Ранкове нагадування', hint: 'О 8:00 — пари та дедлайни на день' },
    ],
  },
  {
    title: 'Пари',
    // hint is replaced at render with the group's actual lead time (lessonHint).
    items: [{ k: 'dmLessonReminder', title: 'Нагадування про пару в ЛС', hint: '' }],
  },
];
const ALL_KEYS = GROUPS.flatMap((g) => g.items.map((i) => i.k));

// Module-level constant so the queryKey reference is stable across renders.
// React Query compares keys by deep equality, but reusing the same array also
// rules out any subtle drift between renders.
const PREFS_QUERY_KEY = ['prefs'] as const;

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: PREFS_QUERY_KEY,
    queryFn: () => api<Prefs>('/notifications/prefs'),
  });
  // Same key as group settings/Home, so the lead time is usually already cached.
  // No active group (teacher-only) → skip the request (it'd 400); errors → generic hint below.
  const activeGroupId = useActiveGroup();
  const groupSettings = useQuery({
    queryKey: ['group-settings'],
    queryFn: () => api<{ lessonReminderMinutes?: number; notificationsEnabled?: boolean }>('/groups/current/settings'),
    enabled: !!activeGroupId,
  });
  const minutes = groupSettings.data?.lessonReminderMinutes;
  // 0 = the scheduler fires right at the start time.
  const lessonHint = `${
    typeof minutes !== 'number' ? 'Перед початком пари' : minutes === 0 ? 'На початку пари' : `За ${minutes} хв`
  }${groupSettings.data?.notificationsEnabled === false ? '' : ' · у чаті групи воно вже є'}`;

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

  const onCount = ALL_KEYS.filter((k) => Boolean(data?.[k])).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Сповіщення" subtitle="Що бот надсилає вам в особисті" />

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          {save.isError ? (
            <div role="alert" className="card-flat small text-bad">
              {save.error.message}
            </div>
          ) : null}

          <section className="card px-4 py-1">
            {/* label: the whole row toggles the switch (switch alone is 30px tall) */}
            <label className="row-plain cursor-pointer justify-between">
              <span className="flex min-w-0 items-center gap-3">
                <span className="tile tile-accent h-10 w-10 rounded-[12px]">
                  <Icon name="bell" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="h3">Сповіщення в ЛС</span>
                  <span className="tiny faint">
                    {onCount} з {ALL_KEYS.length} увімкнено
                  </span>
                </span>
              </span>
              {/* Master switch: on while anything is on; flips every preference in one PATCH. */}
              <Toggle
                checked={onCount > 0}
                label="Усі сповіщення"
                onChange={(v) => save.mutate(Object.fromEntries(ALL_KEYS.map((k) => [k, v])) as Partial<Prefs>)}
              />
            </label>
          </section>

          {GROUPS.map((g) => (
            <Section key={g.title} title={g.title}>
              <div className="card-flat flex flex-col px-3.5 py-1">
                {g.items.map((l, i) => (
                  <Fragment key={l.k}>
                    {i > 0 ? <div className="divider" /> : null}
                    <label className="row-plain cursor-pointer justify-between">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="h3">{l.title}</span>
                        <span className="tiny faint">{l.k === 'dmLessonReminder' ? lessonHint : l.hint}</span>
                      </span>
                      <Toggle
                        checked={Boolean(data?.[l.k])}
                        label={l.title}
                        onChange={(v) => save.mutate({ [l.k]: v } as Partial<Prefs>)}
                      />
                    </label>
                  </Fragment>
                ))}
              </div>
            </Section>
          ))}

          <span className="tiny faint px-3 text-center">
            Бот може писати вам в особисті лише після того, як ви самі натиснете «Start» у чаті з ним.
          </span>
        </>
      )}
    </div>
  );
}
