'use client';

import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../components/Empty';
import { Icon } from '../../../../components/icons';
import { Sheet } from '../../../../components/ui/Sheet';
import { haptic } from '../../../../lib/telegram';
import { cn } from '../../../../lib/cn';
import { useActiveMembership } from '../../../../hooks/useMe';

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

const STATUSES: Array<{ k: Status; label: string; st: string; chip: string; dot: string; legend: string }> = [
  { k: 'present', label: 'П', st: 'on-ok', chip: 'chip-ok', dot: 'bg-ok', legend: 'присутній' },
  { k: 'absent', label: 'Н', st: 'on-bad', chip: 'chip-bad', dot: 'bg-bad', legend: 'відсутній' },
  { k: 'late', label: 'Зап', st: 'on-warn', chip: 'chip-warn', dot: 'bg-warn', legend: 'запізнився' },
  { k: 'excused', label: 'Пов', st: 'on-info', chip: 'chip-info', dot: 'bg-info', legend: 'поважна' },
];

const LESSON_TYPE: Record<string, string> = { lecture: 'лек', practice: 'прак', lab: 'лаб', seminar: 'сем' };

function dayOfWeekFromIso(iso: string): number {
  // Mon=1..Sun=7 → KPI: 1..6 (Sun excluded)
  const dow = ((dayjs(iso).day() + 6) % 7) + 1;
  return dow;
}

export default function MarkAttendancePage() {
  const qc = useQueryClient();
  const membership = useActiveMembership();
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [dateSheet, setDateSheet] = useState(false);
  const [search, setSearch] = useState('');

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

  // Today: preselect the lesson in progress (else the last one that started), once per date —
  // Home's "Відмітити присутніх" lands here without params.
  const [autoPickedFor, setAutoPickedFor] = useState<string | null>(null);
  useEffect(() => {
    if (autoPickedFor === date || selectedLesson || !lessonsQ.data) return;
    setAutoPickedFor(date);
    if (date !== dayjs().format('YYYY-MM-DD')) return;
    const hm = dayjs().format('HH:mm');
    const started = dayLessons.filter((l) => l.startTime <= hm);
    const pick = started.find((l) => hm < l.endTime) ?? started[started.length - 1];
    if (pick) setSelectedLesson(pick._id);
  }, [autoPickedFor, date, selectedLesson, lessonsQ.data, dayLessons]);

  // Hydrate statuses from the saved record once per lesson+date (default unknown).
  // Not on every savedQ/membersQ change: a background refetch (window focus,
  // post-save invalidation) would otherwise wipe unsaved marks.
  const lessonKey = selectedLesson ? `${selectedLesson}::${date}` : null;
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const ready = !!lessonKey && hydratedFor === lessonKey;
  useEffect(() => {
    if (!lessonKey || hydratedFor === lessonKey) return;
    // Wait for a fresh copy: a cached record may be mid-refetch.
    if (!savedQ.data || savedQ.isFetching || !membersQ.data) return;
    const initial: Record<string, Status> = {};
    for (const m of membersQ.data) initial[m._id] = 'unknown';
    for (const e of savedQ.data.entries ?? []) initial[e.userId] = e.status;
    setStatuses(initial);
    setHydratedFor(lessonKey);
  }, [lessonKey, hydratedFor, savedQ.data, savedQ.isFetching, membersQ.data]);

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
      qc.invalidateQueries({ queryKey: ['attendance-grid'] });
      qc.invalidateQueries({ queryKey: ['attendance-lesson', selectedLesson, date] });
    },
    onError: () => haptic('error'),
  });

  const members = membersQ.data ?? [];

  function setAll(s: Status) {
    const next: Record<string, Status> = {};
    for (const m of members) next[m._id] = s;
    setStatuses(next);
  }

  function setRestPresent() {
    setStatuses((prev) => {
      const next = { ...prev };
      for (const m of members) if (!next[m._id] || next[m._id] === 'unknown') next[m._id] = 'present';
      return next;
    });
  }

  function pickDate(value: string) {
    if (!value) return; // cleared native date input
    setDate(value);
    setSelectedLesson(null);
    save.reset();
  }

  const counts = { present: 0, absent: 0, late: 0, excused: 0, unknown: 0 };
  for (const m of members) counts[statuses[m._id] ?? 'unknown'] += 1;
  const marked = members.length - counts.unknown;

  const q = search.trim().toLowerCase();
  const visibleMembers = q
    ? members.filter((m) => m.fullName.toLowerCase().includes(q) || m.username?.toLowerCase().includes(q))
    : members;

  const dateLabel = dayjs(date).locale('uk').format('dd, D MMMM');
  const subtitle = [dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1), membership?.groupName]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Присутність"
        subtitle={subtitle}
        action={
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setDateSheet(true)}>
            Інша дата
          </button>
        }
      />

      {nowQ.isLoading || lessonsQ.isLoading ? (
        <Loading label="Завантаження пар…" />
      ) : nowQ.isError || lessonsQ.isError ? (
        <ErrorState
          title="Не вдалося завантажити розклад"
          error={nowQ.error ?? lessonsQ.error}
          onRetry={() => (nowQ.isError ? nowQ.refetch() : lessonsQ.refetch())}
        />
      ) : dayLessons.length === 0 ? (
        <Empty
          icon="calendar"
          title="У цей день пар немає"
          hint="Або розклад ще не синхронізовано."
          action={
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setDateSheet(true)}>
              Інша дата
            </button>
          }
        />
      ) : (
        <div role="radiogroup" aria-label="Пара" className="flex flex-wrap gap-1.5">
          {dayLessons.map((l) => {
            const on = selectedLesson === l._id;
            const type = l.type ? LESSON_TYPE[l.type] : undefined;
            return (
              <button
                key={l._id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setSelectedLesson(l._id);
                  if (!on) save.reset();
                }}
                className={cn('chip chip-btn h-10 max-w-full gap-1.5 px-3', on && 'chip-ink')}
                title={l.subjectName}
              >
                <span className="num text-xs">{l.startTime}</span>
                <span className="min-w-0 truncate">
                  {l.subjectName}
                  {type ? ` · ${type}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!selectedLesson ? (
        dayLessons.length > 0 ? (
          <Empty icon="calendarCheck" title="Оберіть пару" hint="Після вибору зʼявиться список студентів." />
        ) : null
      ) : !ready && (savedQ.isError || membersQ.isError) ? (
        <ErrorState
          title="Не вдалося завантажити студентів"
          error={savedQ.error ?? membersQ.error}
          onRetry={() => {
            if (savedQ.isError) void savedQ.refetch();
            if (membersQ.isError) void membersQ.refetch();
          }}
        />
      ) : !ready ? (
        <Loading label="Завантаження списку…" />
      ) : (
        <>
          <section className="card-flat flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <Counter value={counts.present} label="присутні" className="text-ok" />
              <Counter value={counts.absent} label="відсутні" className="text-bad" />
              <Counter value={counts.late} label="запізн." className="text-warn" />
              <Counter value={counts.excused} label="поважні" className="text-info" />
              <Counter value={counts.unknown} label="не відм." />
            </div>
            <div className="bar bar-accent" aria-hidden="true">
              <span style={{ width: `${members.length ? (marked / members.length) * 100 : 0}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn btn-secondary btn-sm" onClick={setRestPresent}>
                Решту — П
              </button>
              <span className="small muted ml-1">Усім:</span>
              {STATUSES.map((s) => (
                <button
                  key={s.k}
                  type="button"
                  onClick={() => setAll(s.k)}
                  className={cn('chip chip-btn px-3', s.chip)}
                  aria-label={`Усім: ${s.legend}`}
                >
                  {s.label}
                </button>
              ))}
              <button type="button" onClick={() => setAll('unknown')} className="chip chip-btn px-3">
                Скинути
              </button>
            </div>
          </section>

          <div className="relative">
            <label
              htmlFor="mark-search"
              className="absolute left-3.5 top-0 inline-flex h-11 items-center text-ink-3"
              aria-label="Пошук"
            >
              <Icon name="search" size={18} />
            </label>
            <input
              id="mark-search"
              type="search"
              className="input h-11 pl-[42px]"
              placeholder="Знайти студента"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 px-0.5">
            {STATUSES.map((s) => (
              <span key={s.k} className="tiny inline-flex items-center gap-[5px]">
                <span className={cn('dot', s.dot)} />
                {s.label} — {s.legend}
              </span>
            ))}
          </div>

          {members.length === 0 ? (
            <Empty icon="users" title="У групі ще немає студентів" />
          ) : visibleMembers.length === 0 ? (
            <Empty icon="search" title="Нікого не знайдено" />
          ) : (
            <section aria-label="Студенти" className="card-flat flex flex-col py-1 pl-3.5 pr-2.5">
              {visibleMembers.map((m, i) => (
                <div key={m._id}>
                  {i > 0 ? <div className="divider" /> : null}
                  <div className="row-plain justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="h3 truncate">{m.fullName}</span>
                      {m.username ? <span className="tiny faint truncate">@{m.username}</span> : null}
                    </div>
                    <div className="flex flex-shrink-0 gap-1" role="group" aria-label={m.fullName}>
                      {STATUSES.map((s) => {
                        const active = statuses[m._id] === s.k;
                        return (
                          <button
                            key={s.k}
                            type="button"
                            aria-pressed={active}
                            aria-label={s.legend}
                            onClick={() =>
                              setStatuses((prev) => ({
                                ...prev,
                                [m._id]: active ? 'unknown' : s.k,
                              }))
                            }
                            className={cn('st', active && s.st)}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      <Sheet open={dateSheet} onClose={() => setDateSheet(false)} title="Інша дата">
        <input
          type="date"
          className="input"
          aria-label="Дата"
          value={date}
          onChange={(e) => pickDate(e.target.value)}
        />
        <button type="button" className="btn btn-primary btn-block" onClick={() => setDateSheet(false)}>
          Готово
        </button>
      </Sheet>

      {selectedLesson ? (
        <div className="action-bar flex-col">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={save.isPending || !ready}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Збереження…' : `Зберегти · ${marked} з ${members.length} відмічено`}
          </button>
          {save.isError ? (
            <span className="tiny text-center font-semibold text-bad">
              {(save.error as Error)?.message || 'Не вдалося зберегти'}
            </span>
          ) : save.isSuccess ? (
            <span className="tiny text-center font-semibold text-ok">Збережено</span>
          ) : (
            <span className="tiny faint text-center">Невідмічені залишаться порожніми.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Counter({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className={cn('num text-[20px] leading-none', className)}>{value}</span>
      <span className="tiny faint">{label}</span>
    </div>
  );
}
