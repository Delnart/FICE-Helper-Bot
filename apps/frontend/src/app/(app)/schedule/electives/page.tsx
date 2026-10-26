'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { useCanManage, useMe } from '../../../../hooks/useMe';
import { PageHeader } from '../../../../components/PageHeader';
import { Icon } from '../../../../components/icons';
import { Empty, ErrorState, Loading } from '../../../../components/Empty';
import { cn } from '../../../../lib/cn';
import { shortenName } from '../../../../lib/name';

interface LessonPart {
  _id: string;
  dayOfWeek: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  type?: string;
  weekType?: number;
  teacherNames?: string[];
  room?: string;
}

interface ElectiveDiscipline {
  _id: string;
  subjectName: string;
  sampleLessonId: string;
  lessonIds: string[];
  subjectId?: string;
  electiveStudentIds: string[];
  lessons: LessonPart[];
}

const DAY_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const WEEK_LABEL: Record<number, string> = { 0: 'щотижня', 1: 'I тижд.', 2: 'II тижд.' };
const TYPE_LABEL: Record<string, string> = {
  lecture: 'Лекція',
  practice: 'Практика',
  lab: 'Лаб',
  seminar: 'Семінар',
  other: 'Заняття',
};

/** 1 заняття, 3 заняття, 5 занять. */
const lessonsWord = (n: number) =>
  n % 10 >= 1 && n % 10 <= 4 && !(n % 100 >= 11 && n % 100 <= 14) ? 'заняття' : 'занять';

/** "2 заняття на тиждень" / "1–2 заняття на тиждень" (I and II weeks differ). */
function perWeek(lessons: LessonPart[]): string {
  const w1 = lessons.filter((l) => l.weekType !== 2).length;
  const w2 = lessons.filter((l) => l.weekType !== 1).length;
  const lo = Math.min(w1, w2);
  const hi = Math.max(w1, w2);
  if (!hi) return '';
  return `${lo === hi ? hi : `${lo}–${hi}`} ${lessonsWord(hi)} на тиждень`;
}

/**
 * "Пн · Лекція · щотижня" chips: the same day/time/type in both weeks becomes
 * "щотижня"; slots with the same label merge (times and rooms go to the title).
 */
function slotChips(lessons: LessonPart[]) {
  const slots = new Map<string, { l: LessonPart; weeks: Set<number> }>();
  for (const l of lessons) {
    const key = `${l.dayOfWeek}|${l.startTime}|${l.type ?? ''}`;
    const s = slots.get(key) ?? { l, weeks: new Set<number>() };
    s.weeks.add(l.weekType ?? 0);
    slots.set(key, s);
  }
  const chips = new Map<string, { key: string; label: string; title: string }>();
  [...slots.values()]
    .sort((a, b) => a.l.dayOfWeek - b.l.dayOfWeek || a.l.startTime.localeCompare(b.l.startTime))
    .forEach(({ l, weeks }) => {
      const label = [
        DAY_NAMES[l.dayOfWeek] ?? '',
        TYPE_LABEL[l.type ?? 'other'] ?? 'Заняття',
        WEEK_LABEL[weeks.size > 1 || weeks.has(0) ? 0 : [...weeks][0]],
      ]
        .filter(Boolean)
        .join(' · ');
      const title = [`${l.startTime}–${l.endTime}`, l.room ? `ауд. ${l.room}` : '']
        .filter(Boolean)
        .join(' · ');
      const c = chips.get(label);
      chips.set(label, c ? { ...c, title: `${c.title}; ${title}` } : { key: l._id, label, title });
    });
  return [...chips.values()];
}

export default function ElectivesPage() {
  const me = useMe();
  const canManage = useCanManage();
  const qc = useQueryClient();
  const userId = me.data?._id ?? '';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['schedule-electives'],
    queryFn: () => api<ElectiveDiscipline[]>('/schedule/electives'),
  });

  // Last failed action, shown under the card it belongs to.
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const feedback = {
    onMutate: () => setActionError(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-electives'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (err: Error, lessonId: string) => setActionError({ id: lessonId, message: err.message }),
  };

  const join = useMutation({
    mutationFn: (lessonId: string) =>
      api(`/schedule/electives/${lessonId}/join`, { method: 'POST' }),
    ...feedback,
  });

  const leave = useMutation({
    mutationFn: (lessonId: string) =>
      api(`/schedule/electives/${lessonId}/leave`, { method: 'POST' }),
    ...feedback,
  });

  const removeElective = useMutation({
    mutationFn: (lessonId: string) =>
      api(`/schedule/lessons/${lessonId}/elective`, {
        method: 'PATCH',
        json: { isElective: false },
      }),
    ...feedback,
  });

  const isPending = join.isPending || leave.isPending || removeElective.isPending;
  const enrolledCount = data?.filter((d) => d.electiveStudentIds.includes(userId)).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Вибіркові"
        subtitle={
          data && data.length > 0
            ? `Обрано ${enrolledCount} з ${data.length} · впливає лише на ваш розклад`
            : 'Оберіть дисципліни, які відображатимуться у вашому розкладі'
        }
      />

      <section className="card-soft flex items-start gap-3">
        <span className="tile tile-soft h-9 w-9 rounded-[12px] bg-surface">
          <Icon name="info" size={18} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="h3">Як це працює</span>
          <span className="small muted">
            Відмічені дисципліни — з усіма лекціями, практиками та лабами — показуються у
            вашому розкладі. Невідмічені приховані, але їх можна увімкнути будь-коли.
          </span>
        </div>
      </section>

      {isLoading && <Loading />}

      {isError && (
        <ErrorState
          error={error}
          onRetry={() => refetch()}
          title="Не вдалося завантажити вибіркові"
        />
      )}

      {!isLoading && !isError && (!data || data.length === 0) && (
        <Empty
          title="Вибіркових дисциплін немає"
          hint="Староста ще не позначив жодну дисципліну як вибіркову."
          icon="star"
        />
      )}

      {!isError && data && data.length > 0 && (
        <section aria-label="Список вибіркових" className="flex flex-col gap-2.5">
          {data.map((item) => {
            const enrolled = item.electiveStudentIds.includes(userId);
            const targetId = item.sampleLessonId || item._id;
            const lessons = item.lessons ?? [];
            const teachers = [...new Set(lessons.flatMap((l) => l.teacherNames ?? []))]
              .map(shortenName)
              .join(', ');
            const chips = slotChips(lessons);

            return (
              <div
                key={item._id}
                className={cn('card-flat flex flex-col gap-2', enrolled && 'border-accent')}
              >
                {/* Student enrollment: the whole card body is the checkbox. */}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    enrolled ? leave.mutate(targetId) : join.mutate(targetId)
                  }
                  role="checkbox"
                  aria-checked={enrolled}
                  aria-label={item.subjectName}
                  title={enrolled ? 'Відписатися від вибіркової' : 'Записатися на вибіркову'}
                  className="flex w-full items-start gap-3 text-left text-ink"
                >
                  <span className={cn('check mt-0.5', enrolled && 'on')}>
                    {enrolled ? <Icon name="check" size={16} strokeWidth={3} /> : null}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="h3 text-[16px]">{item.subjectName}</span>
                      <span className="tiny faint">
                        {[teachers, perWeek(lessons)].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    {chips.length > 0 ? (
                      <div className="meta">
                        {chips.map((c) => (
                          <span key={c.key} className="chip" title={c.title}>
                            {c.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </button>

                {actionError?.id === targetId ? (
                  <div role="alert" className="small ml-9 text-bad">
                    {actionError.message}
                  </div>
                ) : null}

                {/* Head: remove from electives */}
                {canManage && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Вилучити «${item.subjectName}» із вибіркових? Дисципліна стане обовʼязковою для всієї групи.`,
                        )
                      ) {
                        removeElective.mutate(targetId);
                      }
                    }}
                    className="btn btn-ghost btn-sm ml-9 self-start px-1 text-ink-3"
                    title="Вилучити дисципліну з вибіркових"
                  >
                    Вилучити з вибіркових · староста
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      <p className="tiny faint px-3 text-center">
        Зміни зберігаються автоматично. Староста позначає заняття як вибіркові в розкладі —
        тут вони зʼявляються автоматично й зберігаються при оновленнях з Кампусу.
      </p>
    </div>
  );
}
