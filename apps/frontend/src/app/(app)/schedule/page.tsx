'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { useMemo, useState } from 'react';
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
  // Teachers use the lecturer endpoints (live from Campus, no active group);
  // students/heads use the local cached group schedule.
  const nowEndpoint = isTeacher ? '/schedule/lecturer/now' : '/schedule/now';
  const weekEndpoint = isTeacher ? '/schedule/lecturer/week' : '/schedule/my';

  const now = useQuery({
    queryKey: ['schedule-now', isTeacher],
    queryFn: () => api<NowResponse>(nowEndpoint),
  });
  const currentWeek = now.data?.weekType ?? 1;
  const [week, setWeek] = useState<1 | 2>(currentWeek);
  const [day, setDay] = useState<number>(today);

  const { data, isLoading } = useQuery({
    queryKey: ['schedule', week, isTeacher],
    queryFn: () => api<Lesson[]>(weekEndpoint, { query: { week } }),
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
        subtitle={`Поточний тиждень: ${currentWeek === 1 ? 'перший' : 'другий'}`}
      />

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
    </div>
  );
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

