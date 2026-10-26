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

const DAY_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
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

            return (
              <div
                key={item._id}
                className={cn('card-flat flex flex-col gap-1', enrolled && 'border-accent')}
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="h3 text-[16px]">{item.subjectName}</span>
                        <span className="tiny faint">
                          {[teachers, `${lessons.length} ${lessonsWord(lessons.length)}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      {enrolled ? (
                        <span className="chip chip-accent flex-shrink-0">обрано</span>
                      ) : null}
                    </div>
                    {lessons.length > 0 ? (
                      <div className="meta">
                        {lessons.map((l, idx) => (
                          <span
                            key={l._id || idx}
                            className="chip h-auto min-h-6 whitespace-normal py-1 leading-tight"
                          >
                            {[
                              DAY_NAMES[l.dayOfWeek] ?? '',
                              `${l.startTime}–${l.endTime}`,
                              TYPE_LABEL[l.type ?? 'other'] ?? 'Заняття',
                              WEEK_LABEL[l.weekType ?? 0],
                              l.room,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </button>

                {actionError?.id === targetId ? (
                  <div role="alert" className="small ml-8 text-bad">
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
                    className="btn btn-ghost btn-sm ml-8 self-start px-1 text-ink-3"
                    title="Вилучити дисципліну з вибіркових"
                    aria-label="Вилучити з вибіркових"
                  >
                    <Icon name="trash" size={16} />
                    Вилучити з вибіркових
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
