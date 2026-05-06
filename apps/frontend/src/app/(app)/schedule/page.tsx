'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { cn } from '../../../lib/cn';
import { shortenName } from '../../../lib/name';
import { useIsTeacherOnly } from '../../../hooks/useMe';

dayjs.locale('uk');

interface Lesson {
  _id: string;
  subjectId?: string;
  dayOfWeek: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  groupName?: string;
  groupCampusId?: string;
  teacherNames: string[];
  room?: string;
  meetingUrl?: string;
  type?: string;
  weekType?: number;
  isElective?: boolean;
}

interface NowResponse {
  current: Lesson | null;
  next: Lesson | null;
  weekType: 1 | 2;
}

interface SessionItem {
  _id: string;
  subjectName: string;
  subjectId?: string;
  groupName?: string;
  /** ISO date — "2026-01-12". */
  date: string;
  startTime?: string;
  endTime?: string;
  type: 'exam' | 'credit' | 'other';
  room?: string;
  teacherNames?: string[];
}

const SESSION_TYPE_LABEL: Record<SessionItem['type'], string> = {
  exam: 'Іспит',
  credit: 'Залік',
  other: 'ПМК',
};
const SESSION_TYPE_TONE: Record<SessionItem['type'], string> = {
  exam: 'bg-danger/10 text-danger',
  credit: 'bg-accent-soft text-accent',
  other: 'bg-paper-200 text-zinc-700',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

// Source: https://api.campus.kpi.ua/schedule/lessons/slots
const KPI_PAIRS = [
  { start: '08:30', end: '10:05' },
  { start: '10:25', end: '12:00' },
  { start: '12:20', end: '13:55' },
  { start: '14:15', end: '15:50' },
  { start: '16:10', end: '17:45' },
  { start: '18:05', end: '19:40' },
  { start: '20:00', end: '21:35' },
];

const TYPE_CHIP: Record<string, { label: string; cls: string }> = {
  lecture: { label: 'Лекція', cls: 'bg-paper-200 text-zinc-700' },
  practice: { label: 'Практика', cls: 'bg-paper-200 text-zinc-700' },
  lab: { label: 'Лабораторна', cls: 'bg-zinc-100 text-zinc-900' },
  seminar: { label: 'Семінар', cls: 'bg-paper-200 text-zinc-700' },
  other: { label: 'Інше', cls: 'bg-paper-200 text-zinc-700' },
};

export default function SchedulePage() {
  const isTeacher = useIsTeacherOnly();
  const today = Math.min(6, ((dayjs().day() + 6) % 7) + 1);
  // Two top-level views on this page: weekly schedule and the exam (session) one.
  const [view, setView] = useState<'week' | 'sessions'>('week');
  // Teachers use the lecturer endpoints (live from Campus, no active group);
  // students/heads use the local cached group schedule.
  const nowEndpoint = isTeacher ? '/schedule/lecturer/now' : '/schedule/now';
  const weekEndpoint = isTeacher ? '/schedule/lecturer/week' : '/schedule/my';
  const sessionsEndpoint = isTeacher
    ? '/schedule/lecturer/sessions'
    : '/schedule/sessions';

  const now = useQuery({
    queryKey: ['schedule-now', isTeacher],
    queryFn: () => api<NowResponse>(nowEndpoint),
  });
  const currentWeek = now.data?.weekType ?? 1;
  // `week` initializes to 1, but we sync it to the actual current week as soon
  // as the API tells us which week is "now" — once. After that the user is in
  // control (they can flip tabs and we don't override).
  const [week, setWeek] = useState<1 | 2>(currentWeek);
  const [day, setDay] = useState<number>(today);
  const weekHydrated = useRef(false);
  useEffect(() => {
    if (weekHydrated.current) return;
    if (now.data?.weekType) {
      setWeek(now.data.weekType);
      weekHydrated.current = true;
    }
  }, [now.data?.weekType]);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule', week, isTeacher],
    queryFn: () => api<Lesson[]>(weekEndpoint, { query: { week } }),
    enabled: view === 'week',
  });

  const sessions = useQuery({
    queryKey: ['schedule-sessions', isTeacher],
    queryFn: () => api<SessionItem[]>(sessionsEndpoint),
    enabled: view === 'sessions',
  });

  const dayLessons = useMemo(() => {
    return (data ?? [])
      .filter((l) => l.dayOfWeek === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [data, day]);

  const slotMap = useMemo(() => {
    const m = new Map<string, Lesson>();
    for (const l of dayLessons) m.set(l.startTime, l);
    return m;
  }, [dayLessons]);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Розклад"
        subtitle={
          view === 'week'
            ? `Поточний тиждень: ${currentWeek === 1 ? 'перший' : 'другий'}`
            : 'Іспити та заліки'
        }
      />

      {/* Top-level view tabs: semester schedule vs session (exam) schedule */}
      <div className="flex bg-paper-100 rounded-2xl p-1 gap-1">
        <button
          onClick={() => setView('week')}
          className={cn(
            'flex-1 h-9 rounded-xl text-sm font-medium transition-colors',
            view === 'week'
              ? 'bg-paper-50 text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700',
          )}
        >
          Семестр
        </button>
        <button
          onClick={() => setView('sessions')}
          className={cn(
            'flex-1 h-9 rounded-xl text-sm font-medium transition-colors',
            view === 'sessions'
              ? 'bg-paper-50 text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700',
          )}
        >
          Сесія
        </button>
      </div>

      {view === 'sessions' ? (
        <SessionsView query={sessions} />
      ) : (
        <>
          {/* Week tabs */}
          <div className="flex bg-paper-100 rounded-2xl p-1 gap-1">
            {([1, 2] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWeek(w)}
                className={cn(
                  'flex-1 h-9 rounded-xl text-sm font-medium transition-colors',
                  week === w
                    ? 'bg-paper-50 text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700',
                )}
              >
                {w === 1 ? 'Перший тиждень' : 'Другий тиждень'}
              </button>
            ))}
          </div>

          {/* Day capsules */}
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="inline-flex gap-1.5 p-1 bg-paper-100 rounded-full">
              {WEEKDAYS.map((w, i) => {
                const d = i + 1;
                const isToday = d === today && week === currentWeek;
                return (
                  <button
                    key={d}
                    onClick={() => setDay(d)}
                    className={cn(
                      'min-w-[44px] h-9 px-3 rounded-full text-sm font-semibold transition-colors',
                      day === d
                        ? 'bg-zinc-900 text-white shadow-sm ring-1 ring-zinc-900/10'
                        : isToday
                          ? 'text-zinc-900 underline underline-offset-4'
                          : 'text-zinc-700 hover:bg-zinc-100',
                    )}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          </div>

          {isLoading ? (
            <div className="card text-sm text-ink-500">Завантаження…</div>
          ) : (
            <div className="relative pl-[60px] pr-1 pb-2">
              {/* Vertical dashed line */}
              <div className="absolute left-[35px] top-2 bottom-2 border-l-2 border-dashed border-paper-300" />

              {KPI_PAIRS.map((slot) => {
                const lesson = slotMap.get(slot.start);
                return (
                  <div key={slot.start} className="relative flex items-start gap-3 mb-3 last:mb-0">
                    {/* Time badge */}
                    <div className="absolute -left-[60px] top-0">
                      <span className="inline-flex items-center justify-center min-w-[50px] h-6 px-2 rounded-full bg-zinc-900 text-white text-[11px] font-bold tabular-nums shadow-sm ring-1 ring-zinc-900/10">
                        {slot.start}
                      </span>
                    </div>
                    {/* Card or empty space */}
                    <div className="flex-1 min-h-[48px]">
                      {lesson ? <LessonCard l={lesson} /> : null}
                    </div>
                  </div>
                );
              })}

              {/* Lessons that don't match a known KPI start time (rare) */}
              {dayLessons
                .filter((l) => !KPI_PAIRS.find((p) => p.start === l.startTime))
                .map((l) => (
                  <div key={l._id} className="relative flex items-start gap-3 mb-3">
                    <div className="absolute -left-[60px] top-0">
                      <span className="inline-flex items-center justify-center min-w-[50px] h-6 px-2 rounded-full bg-zinc-200 text-zinc-700 text-[11px] font-bold tabular-nums">
                        {l.startTime}
                      </span>
                    </div>
                    <div className="flex-1">
                      <LessonCard l={l} />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Сесія" tab — vertical list of upcoming exams grouped by month.
 * Past exams are hidden by default; user can toggle to see them too.
 */
function SessionsView({
  query,
}: {
  query: ReturnType<typeof useQuery<SessionItem[], Error, SessionItem[]>>;
}) {
  const [showPast, setShowPast] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');
  const all = query.data ?? [];
  const visible = showPast ? all : all.filter((s) => s.date >= today);
  const past = all.length - visible.length;

  if (query.isLoading) {
    return <div className="card text-sm text-ink-500">Завантаження…</div>;
  }
  if (query.isError) {
    return (
      <div className="card text-sm text-danger">
        Не вдалося завантажити розклад сесії.
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <div className="card text-sm text-ink-500">
        Кампус ще не опублікував розклад сесії для цієї групи.
      </div>
    );
  }

  // Group by ISO YYYY-MM for visual breaks.
  const groups = new Map<string, SessionItem[]>();
  for (const s of visible) {
    const key = s.date.slice(0, 7);
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([month, list]) => (
        <section key={month} className="space-y-2">
          <div className="section-title">{formatMonthLabel(month)}</div>
          <div className="space-y-2">
            {list.map((s) => (
              <SessionCard key={s._id} s={s} />
            ))}
          </div>
        </section>
      ))}
      {!showPast && past > 0 ? (
        <button
          type="button"
          className="btn-secondary w-full text-sm"
          onClick={() => setShowPast(true)}
        >
          Показати минулі ({past})
        </button>
      ) : null}
    </div>
  );
}

function SessionCard({ s }: { s: SessionItem }) {
  const date = dayjs(s.date);
  const isPast = date.isBefore(dayjs().startOf('day'));
  const card = (
    <div
      className={cn(
        'card flex items-start gap-3',
        isPast && 'opacity-60',
        s.subjectId && 'hover:bg-paper-100 cursor-pointer',
      )}
    >
      <div className="flex-shrink-0 w-12 text-center">
        <div className="text-[11px] uppercase font-semibold text-zinc-500 tracking-wide">
          {date.format('MMM')}
        </div>
        <div className="text-[22px] font-bold leading-none mt-0.5 tabular-nums">
          {date.format('DD')}
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">{date.format('dd')}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={cn('chip text-[10px]', SESSION_TYPE_TONE[s.type])}>
            {SESSION_TYPE_LABEL[s.type]}
          </span>
          {s.startTime ? (
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {s.startTime}
              {s.endTime ? ` – ${s.endTime}` : ''}
            </span>
          ) : null}
          {s.groupName ? (
            <span className="text-[11px] text-zinc-500">{s.groupName}</span>
          ) : null}
        </div>
        <div className="font-semibold text-[14px] leading-snug">{s.subjectName}</div>
        {s.room ? (
          <div className="text-[12px] text-zinc-500 mt-0.5">📍 {s.room}</div>
        ) : null}
        {s.teacherNames?.length ? (
          <div className="text-[12px] text-zinc-500 mt-0.5 truncate">
            {s.teacherNames.join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (s.subjectId) {
    return (
      <Link href={`/subjects/${s.subjectId}` as unknown as never}>{card}</Link>
    );
  }
  return card;
}

function formatMonthLabel(month: string): string {
  const d = dayjs(`${month}-01`);
  // "Січень 2026"
  const m = d.format('MMMM');
  return `${m[0].toUpperCase()}${m.slice(1)} ${d.format('YYYY')}`;
}

function LessonCard({ l }: { l: Lesson }) {
  const chip = TYPE_CHIP[l.type ?? 'other'] ?? TYPE_CHIP.other;
  const linkable = !!l.subjectId;

  const card = (
    <div
      className={cn(
        'card transition-colors space-y-1.5',
        linkable && 'hover:bg-paper-100 cursor-pointer',
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('chip text-[11px]', chip.cls)}>{chip.label}</span>
        <span className="text-[11px] text-zinc-500 tabular-nums">
          {l.startTime} – {l.endTime}
        </span>
        {l.isElective ? (
          <span className="chip text-[11px] bg-zinc-200 text-zinc-700">вибіркова</span>
        ) : null}
      </div>
      <div className="font-semibold text-[14px] leading-snug">{l.subjectName}</div>
      {l.groupName ? <div className="text-[12px] text-zinc-500">{l.groupName}</div> : null}
      {l.teacherNames.length ? (
        <div className="flex items-center gap-1.5 text-[12px] text-zinc-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-zinc-500 flex-shrink-0">
            <path d="M22 10L12 4 2 10l10 6 10-6zM6 12v5c0 1 3 3 6 3s6-2 6-3v-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate" title={l.teacherNames.join(', ')}>
            {l.teacherNames.map(shortenName).join(', ')}
          </span>
        </div>
      ) : null}
      {l.room ? (
        <div className="flex items-center gap-1.5 text-[12px] text-zinc-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-zinc-500 flex-shrink-0">
            <path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z" strokeLinejoin="round" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <span className="underline decoration-dotted">{l.room}</span>
        </div>
      ) : null}
      {l.meetingUrl ? (
        <a
          href={l.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[12px] text-zinc-900 underline underline-offset-2 mt-0.5 hover:text-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          Перейти до зустрічі ↗
        </a>
      ) : null}
    </div>
  );

  if (l.subjectId) {
    return (
      <Link href={`/subjects/${l.subjectId}`} className="block">
        {card}
      </Link>
    );
  }
  return card;
}

