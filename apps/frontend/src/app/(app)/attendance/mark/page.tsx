'use client';

import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { Empty } from '../../../../components/Empty';
import { haptic } from '../../../../lib/telegram';
import { cn } from '../../../../lib/cn';

type Status = 'present' | 'absent' | 'late' | 'excused' | 'unknown';

interface GroupLesson {
  _id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  room?: string;
  type?: string;
  weekType: 0 | 1 | 2;
  isElective?: boolean;
}

interface Member {
  _id: string;
  fullName: string;
  username?: string;
  role: string;
}

interface SavedRecord {
  entries: Array<{ userId: string; status: Status; note?: string }>;
}

const STATUSES: Array<{ k: Status; label: string; cls: string }> = [
  { k: 'present', label: 'П', cls: 'bg-success/10 text-success' },
  { k: 'late', label: 'Зап', cls: 'bg-accent-soft text-accent' },
  { k: 'excused', label: 'Пов', cls: 'bg-warn/10 text-warn' },
  { k: 'absent', label: 'Н', cls: 'bg-danger/10 text-danger' },
];

function dayOfWeekFromIso(iso: string): number {
  // Mon=1..Sun=7 → KPI: 1..6 (Sun excluded)
  const dow = ((dayjs(iso).day() + 6) % 7) + 1;
  return dow;
}

export default function MarkAttendancePage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  // Determine current week parity from /schedule/now (which exposes weekType)
  const nowQ = useQuery({
    queryKey: ['schedule-now'],
    queryFn: () => api<{ weekType: 1 | 2 }>('/schedule/now'),
  });
  const week = nowQ.data?.weekType ?? 1;

  // Lessons of the active group for the current parity
  const lessonsQ = useQuery({
    queryKey: ['schedule-group-week', week],
    queryFn: () => api<GroupLesson[]>('/schedule/group-week', { query: { week: String(week) } }),
    enabled: !!nowQ.data,
  });

  // Group members
  const membersQ = useQuery({
    queryKey: ['group-members'],
    queryFn: () => api<Member[]>('/users/group'),
  });

  // Currently saved record for the chosen lesson + date
  const savedQ = useQuery({
    queryKey: ['attendance-lesson', selectedLesson, date],
    queryFn: () =>
      api<SavedRecord>('/attendance/lesson', { query: { lessonId: selectedLesson!, date } }),
    enabled: !!selectedLesson,
  });

  const dayLessons = useMemo(() => {
    const dow = dayOfWeekFromIso(date);
    return (lessonsQ.data ?? [])
      .filter((l) => l.dayOfWeek === dow)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [lessonsQ.data, date]);

  // When user picks a lesson or date, hydrate statuses from saved (default unknown)
  useEffect(() => {
    if (!selectedLesson) return;
    const initial: Record<string, Status> = {};
    for (const m of membersQ.data ?? []) initial[m._id] = 'unknown';
    for (const e of savedQ.data?.entries ?? []) initial[e.userId] = e.status;
    setStatuses(initial);
  }, [selectedLesson, savedQ.data, membersQ.data]);

  const save = useMutation({
    mutationFn: () =>
      api('/attendance', {
        method: 'POST',
        json: {
          scheduleLessonId: selectedLesson,
          date: dayjs(date).toISOString(),
          entries: Object.entries(statuses)
            .filter(([, s]) => s && s !== 'unknown')
            .map(([userId, status]) => ({ userId, status })),
        },
      }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['attendance-stats'] });
      qc.invalidateQueries({ queryKey: ['attendance-lesson', selectedLesson, date] });
    },
    onError: () => haptic('error'),
  });

  function setAll(s: Status) {
    const next: Record<string, Status> = {};
    for (const m of membersQ.data ?? []) next[m._id] = s;
    setStatuses(next);
  }

  const lesson = dayLessons.find((l) => l._id === selectedLesson) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title="Відмітити пари" subtitle={lesson ? lesson.subjectName : 'Оберіть пару'} />

      <section className="card space-y-3">
        <div>
          <div className="label">Дата</div>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedLesson(null);
            }}
          />
        </div>
        <div>
          <div className="label">Пара</div>
          {lessonsQ.isLoading ? (
            <div className="text-sm text-ink-500">Завантаження…</div>
          ) : dayLessons.length === 0 ? (
            <div className="text-sm text-ink-500">У цей день пар немає (або не синхронізовано розклад)</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dayLessons.map((l) => (
                <button
                  key={l._id}
                  type="button"
                  onClick={() => setSelectedLesson(l._id)}
                  className={cn(
                    'px-3 h-9 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                    selectedLesson === l._id
                      ? 'bg-ink-900 text-paper-50'
                      : 'bg-paper-200 text-ink-700 hover:bg-paper-300',
                  )}
                  title={l.subjectName}
                >
                  {l.startTime} · {l.subjectName}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedLesson ? (
        <>
          <section className="card flex flex-wrap gap-2 items-center">
            <span className="text-sm text-ink-500">Усім:</span>
            {STATUSES.map((s) => (
              <button
                key={s.k}
                type="button"
                onClick={() => setAll(s.k)}
                className={cn('chip', s.cls)}
              >
                {s.label}
              </button>
            ))}
            <button type="button" onClick={() => setAll('unknown')} className="chip">
              Скинути
            </button>
          </section>

          {membersQ.isLoading ? (
            <div className="card text-sm text-ink-500">Завантаження списку…</div>
          ) : (membersQ.data ?? []).length === 0 ? (
            <Empty title="У групі ще немає студентів" />
          ) : (
            <div className="space-y-2">
              {(membersQ.data ?? []).map((m) => (
                <div key={m._id} className="card">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{m.fullName}</div>
                      {m.username ? (
                        <div className="text-xs text-ink-500">@{m.username}</div>
                      ) : null}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {STATUSES.map((s) => {
                        const active = statuses[m._id] === s.k;
                        return (
                          <button
                            key={s.k}
                            type="button"
                            onClick={() =>
                              setStatuses((prev) => ({
                                ...prev,
                                [m._id]: active ? 'unknown' : s.k,
                              }))
                            }
                            className={cn(
                              'h-8 min-w-[2.5rem] px-2 rounded-md text-xs font-semibold transition-colors',
                              active ? s.cls : 'bg-paper-200 text-ink-500 hover:bg-paper-300',
                            )}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="sticky bottom-20 z-20">
            <button
              type="button"
              className="btn-primary w-full"
              disabled={save.isPending || !selectedLesson}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Збереження…' : 'Зберегти'}
            </button>
            {save.isSuccess ? (
              <div className="text-sm text-success mt-2 text-center">Збережено</div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
