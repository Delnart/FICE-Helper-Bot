'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { useCanManage, useMe } from '../../../../hooks/useMe';
import { PageHeader } from '../../../../components/PageHeader';
import { cn } from '../../../../lib/cn';

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
const WEEK_LABEL: Record<number, string> = { 0: '', 1: 'I тижд.', 2: 'II тижд.' };
const TYPE_LABEL: Record<string, string> = {
  lecture: 'Лекція',
  practice: 'Практика',
  lab: 'Лабораторна',
  seminar: 'Семінар',
  other: 'Заняття',
};

export default function ElectivesPage() {
  const me = useMe();
  const canManage = useCanManage();
  const qc = useQueryClient();
  const userId = me.data?._id ?? '';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['schedule-electives'],
    queryFn: () => api<ElectiveDiscipline[]>('/schedule/electives'),
  });

  const join = useMutation({
    mutationFn: (lessonId: string) =>
      api(`/schedule/electives/${lessonId}/join`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-electives'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  const leave = useMutation({
    mutationFn: (lessonId: string) =>
      api(`/schedule/electives/${lessonId}/leave`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-electives'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  const removeElective = useMutation({
    mutationFn: (lessonId: string) =>
      api(`/schedule/lessons/${lessonId}/elective`, {
        method: 'PATCH',
        json: { isElective: false },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-electives'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  const isPending = join.isPending || leave.isPending || removeElective.isPending;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Вибіркові дисципліни"
        subtitle="Оберіть дисципліни, які відображатимуться у вашому розкладі"
      />

      {isLoading && (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      )}

      {isError && (
        <div className="card text-sm text-danger">
          Не вдалося завантажити список вибіркових дисциплін.
        </div>
      )}

      {!isLoading && !isError && (!data || data.length === 0) && (
        <div className="card text-sm text-ink-500">
          <div className="font-medium mb-1">Вибіркових дисциплін немає</div>
          <div className="text-zinc-500">
            Староста ще не позначив жодну дисципліну як вибіркову.
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((item) => {
            const enrolled = item.electiveStudentIds.includes(userId);
            const targetId = item.sampleLessonId || item._id;

            return (
              <div
                key={item._id}
                className={cn(
                  'card flex items-start gap-3 transition-colors',
                  enrolled ? 'ring-1 ring-accent/30 bg-accent-soft/30' : '',
                )}
              >
                {/* Student Enrollment Checkbox */}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    enrolled ? leave.mutate(targetId) : join.mutate(targetId)
                  }
                  className={cn(
                    'mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                    enrolled
                      ? 'bg-accent border-accent text-white'
                      : 'border-zinc-300 bg-white',
                    isPending && 'opacity-50 cursor-not-allowed',
                  )}
                  aria-label={enrolled ? 'Відписатися від вибіркової' : 'Записатися на вибіркову'}
                >
                  {enrolled && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {/* Discipline Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-[14px] leading-snug">
                      {item.subjectName}
                    </div>

                    {/* Head: Remove from electives button */}
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
                        className="flex-shrink-0 text-zinc-400 hover:text-danger p-1 rounded transition-colors"
                        title="Вилучити дисципліну з вибіркових"
                        aria-label="Вилучити з вибіркових"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Components (lectures, labs, practices) */}
                  <div className="mt-1 space-y-0.5">
                    {(item.lessons ?? []).map((l, idx) => (
                      <div key={l._id || idx} className="flex items-center gap-1.5 text-[11px] text-zinc-600 flex-wrap">
                        <span className="font-medium text-zinc-700">
                          {TYPE_LABEL[l.type ?? 'other'] ?? 'Заняття'}:
                        </span>
                        <span>{DAY_NAMES[l.dayOfWeek] ?? ''}</span>
                        <span className="tabular-nums">{l.startTime} – {l.endTime}</span>
                        {l.weekType ? (
                          <span className="chip text-[9px] px-1 py-0 bg-paper-200 text-zinc-600">
                            {WEEK_LABEL[l.weekType]}
                          </span>
                        ) : null}
                        {l.room ? <span className="text-zinc-400">({l.room})</span> : null}
                      </div>
                    ))}
                  </div>

                  {enrolled && (
                    <div className="mt-1.5">
                      <span className="chip text-[10px] bg-accent-soft text-accent">
                        обрано
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card text-[12px] text-zinc-500 space-y-1">
        <div className="font-medium text-zinc-700">Як це працює?</div>
        <div>✅ Відмічені дисципліни (всі їх лекції, практики і лаби) відображаються у вашому розкладі</div>
        <div>☐ Невідмічені — приховані (ви можете обрати їх у будь-який момент)</div>
        <div>Зміни зберігаються автоматично після натискання.</div>
      </div>
    </div>
  );
}
