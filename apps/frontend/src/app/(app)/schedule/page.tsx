'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Icon } from '../../../components/icons';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Section } from '../../../components/ui/Section';
import { cn, slideVars } from '../../../lib/cn';
import { haptic } from '../../../lib/telegram';
import { useSwipe } from '../../../hooks/useSwipe';
import { shortenName } from '../../../lib/name';
import {
  isQueueOpen,
  queueBySubject,
  takenSlots,
  type RawQueue,
} from '../../../components/subjects/helpers';
import {
  useActiveMembership,
  useCanManage,
  useIsTeacherOnly,
  useMe,
} from '../../../hooks/useMe';

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

interface ElectiveSummary {
  _id: string;
  electiveStudentIds: string[];
}

/** GET /subjects — only the fields the lesson cards need. */
interface SubjectInfo {
  _id: string;
  isOnline?: boolean;
  links?: Array<{ url: string; showInLessonReminder?: boolean; lessonReminderType?: string }>;
  settings?: { hideQueue?: boolean; hideHomework?: boolean };
}

type AttStatus = 'present' | 'absent' | 'late' | 'excused' | 'unknown';

/** Extras for the in-progress lesson card. */
interface LiveInfo {
  /** Minutes left and % elapsed. */
  left: number;
  progress: number;
  queue?: { href: string; label: string };
  hw?: { href: string; count: number };
}

const ATT_CHIP: Partial<Record<AttStatus, { label: string; title: string; cls: string }>> = {
  present: { label: 'П', title: 'Присутність', cls: 'chip-ok' },
  late: { label: 'Зап', title: 'Запізнення', cls: 'chip-info' },
  excused: { label: 'Пов', title: 'Поважна причина', cls: 'chip-warn' },
  absent: { label: 'Н', title: 'Відсутність', cls: 'chip-bad' },
};

/** Entries still waiting for their turn (passed / missed / failed are done). */
const WAITING = new Set(['default', 'preparing', 'passing']);

/** Same label as the Сьогодні card: heads see slots, students their turn. */
function queueLabel(q: RawQueue | undefined, userId: string, canManage: boolean): string {
  if (!q) return 'Черга';
  if (canManage) return `Черга ${takenSlots(q)}/${q.slotsCount}`;
  const waiting = (q.entries ?? []).filter((e) => WAITING.has(e.status ?? 'default'));
  const mine = waiting.filter((e) => String(e.userId) === userId).map((e) => e.slotIndex);
  if (mine.length) {
    const slot = Math.min(...mine);
    const ahead = new Set(waiting.filter((e) => e.slotIndex < slot).map((e) => e.slotIndex));
    return `Черга · ви ${ahead.size + 1}-й`;
  }
  return isQueueOpen(q) ? `Черга · ${takenSlots(q)}/${q.slotsCount}` : 'Черга';
}

const SESSION_TYPE_LABEL: Record<SessionItem['type'], string> = {
  exam: 'Іспит',
  credit: 'Залік',
  other: 'ПМК',
};
const SESSION_TYPE_TONE: Record<SessionItem['type'], string> = {
  exam: 'chip-bad',
  credit: 'chip-accent',
  other: '',
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

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

const TYPE_LABEL: Record<string, string> = {
  lecture: 'Лекція',
  practice: 'Практика',
  lab: 'Лабораторна',
  seminar: 'Семінар',
  other: 'Інше',
};

const ROMAN = { 1: 'I', 2: 'II' } as const;

/** "08:30" → minutes since midnight. */
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Next KPI slot after the last lesson (the first slot with no lessons), else its end. */
const endOfDay = (end: string) =>
  KPI_PAIRS.find((p) => toMin(p.start) >= toMin(end))?.start ?? end;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function meetingLabel(url: string): string {
  if (/meet\.google/i.test(url)) return 'Google Meet';
  if (/zoom\./i.test(url)) return 'Zoom';
  if (/teams\.(microsoft|live)/i.test(url)) return 'Teams';
  return 'Зустріч';
}

export default function SchedulePage() {
  const isTeacher = useIsTeacherOnly();
  const canManage = useCanManage();
  const membership = useActiveMembership();
  const me = useMe();
  const today = ((dayjs().day() + 6) % 7) + 1; // Mon=1..Sun=7
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

  // Minute-resolution clock for the "зараз" card and past-lesson dimming.
  const [clock, setClock] = useState(() => dayjs());
  useEffect(() => {
    const t = setInterval(() => setClock(dayjs()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['schedule', week, isTeacher],
    queryFn: () => api<Lesson[]>(weekEndpoint, { query: { week } }),
    enabled: view === 'week',
  });

  const sessions = useQuery({
    queryKey: ['schedule-sessions', isTeacher],
    queryFn: () => api<SessionItem[]>(sessionsEndpoint),
    enabled: view === 'sessions',
  });

  // Same cache entry as /schedule/electives — feeds the "Обрано X з Y" line.
  const electives = useQuery({
    queryKey: ['schedule-electives'],
    queryFn: () => api<ElectiveSummary[]>('/schedule/electives'),
    enabled: !!me.data && !isTeacher && view === 'week',
  });

  const dayLessons = useMemo(() => {
    return (data ?? [])
      .filter((l) => l.dayOfWeek === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [data, day]);

  // Calendar dates for the strip: this week, or the next one when the other
  // week type is selected (weeks alternate).
  const monday = dayjs()
    .subtract((dayjs().day() + 6) % 7, 'day')
    .add(now.data && week !== currentWeek ? 7 : 0, 'day');
  const selectedDate = monday.add(day - 1, 'day');

  // Swipe between days across the two visible weeks: 0–6 this one, 7–13 the next.
  const pos = (week === currentWeek ? 0 : 7) + day - 1;
  const daysRef = useRef<HTMLDivElement>(null);
  const swipeRef = useSwipe((dir) => {
    const p = pos + dir;
    if (p < 0 || p > 13) return null;
    return () => {
      // Swiped further down a long day: bring back the strip, the only sign of which day it is now.
      if ((daysRef.current?.getBoundingClientRect().top ?? 0) < 0) window.scrollTo(0, 0);
      setWeek(p < 7 ? currentWeek : currentWeek === 1 ? 2 : 1);
      setDay((p % 7) + 1);
      haptic('selection');
    };
  });

  const isLiveDay = !!now.data && week === currentWeek && ((clock.day() + 6) % 7) + 1 === day;
  const nowMin = clock.hour() * 60 + clock.minute();
  const liveLesson = isLiveDay
    ? dayLessons.find((l) => toMin(l.startTime) <= nowMin && nowMin < toMin(l.endTime))
    : undefined;
  const liveSubjectId = isTeacher ? undefined : liveLesson?.subjectId;

  // Card extras (students/heads only): own marks this week, the subject's
  // reminder link / queue / homework. Same cache keys as Сьогодні and Дисципліни.
  const marks = useQuery({
    queryKey: ['attendance', 'my'],
    queryFn: () => api<Array<{ lessonId: string; status: AttStatus }>>('/attendance/my'),
    enabled: !!me.data && !isTeacher && view === 'week',
  });
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectInfo[]>('/subjects'),
    enabled: !!me.data && !isTeacher && view === 'week',
  });
  const queues = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<RawQueue[]>('/queues'),
    enabled: !!liveSubjectId,
  });
  const hwPending = useQuery({
    queryKey: ['hw-pending-count'],
    queryFn: () => api<Array<{ subjectId: string }>>('/homework/my/pending'),
    enabled: !!liveSubjectId,
  });

  const markOf = (id: string) =>
    ATT_CHIP[marks.data?.find((m) => m.lessonId === id)?.status ?? 'unknown'];
  const subjectOf = (id?: string) => (id ? subjects.data?.find((s) => s._id === id) : undefined);
  // Lesson link, else the subject link the head flagged for lesson reminders.
  const joinUrlOf = (l: Lesson) =>
    l.meetingUrl ??
    subjectOf(l.subjectId)?.links?.find(
      (k) => k.showInLessonReminder && (!k.lessonReminderType || k.lessonReminderType === l.type),
    )?.url;

  const liveExtras = (l: Lesson): Pick<LiveInfo, 'queue' | 'hw'> => {
    if (!liveSubjectId || l.subjectId !== liveSubjectId) return {};
    const settings = subjectOf(l.subjectId)?.settings;
    const hwCount = (hwPending.data ?? []).filter((h) => h.subjectId === l.subjectId).length;
    return {
      queue:
        canManage || !settings?.hideQueue
          ? {
              href: `/subjects/${l.subjectId}/queue`,
              label: queueLabel(
                queueBySubject(queues.data).get(l.subjectId),
                me.data?._id ?? '',
                canManage,
              ),
            }
          : undefined,
      hw:
        hwCount && (canManage || !settings?.hideHomework)
          ? { href: `/subjects/${l.subjectId}/homework`, count: hwCount }
          : undefined,
    };
  };

  const enrolledCount = electives.data?.filter((e) =>
    e.electiveStudentIds.includes(me.data?._id ?? ''),
  ).length;

  // Teachers see several groups at once — no single group in the subtitle.
  const groupName = isTeacher ? undefined : membership?.groupName;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Розклад"
        subtitle={
          view === 'week'
            ? `${capitalize(selectedDate.format('MMMM YYYY'))}${groupName ? ` · ${groupName}` : ''}`
            : 'Іспити та заліки'
        }
        action={
          view === 'week' ? (
            // mt-0.5: PageHeader top-aligns the action; the mockup centres it on the title block.
            <button
              type="button"
              className="btn btn-outline btn-md mt-0.5"
              onClick={() => setView('sessions')}
            >
              <Icon name="calendarCheck" size={18} />
              Сесія
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-md mt-0.5"
              onClick={() => setView('week')}
            >
              <Icon name="calendar" size={18} />
              Семестр
            </button>
          )
        }
      />

      {view === 'sessions' ? (
        <SessionsView query={sessions} />
      ) : (
        <>
          <section aria-label="Дні тижня" className="flex flex-col gap-2.5">
            {/* Keyed by week: a new week's strip shows its pill in place instead of sliding it across. */}
            <div key={week} ref={daysRef} className="days" style={slideVars(day - 1)}>
              {WEEKDAYS.map((w, i) => {
                const d = i + 1;
                const isToday = d === today && week === currentWeek;
                // Days without lessons are dimmed, like Sunday in the mockup.
                const free = !!data && !data.some((l) => l.dayOfWeek === d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    aria-pressed={day === d}
                    className={cn('day min-w-0 flex-1', day === d && 'on', isToday && 'today', free && 'free')}
                  >
                    <span className="dow">{w}</span>
                    <span className="dnum">{monday.add(i, 'day').date()}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={cn('chip', now.data && week === currentWeek && 'chip-accent')}>
                {ROMAN[week]} тиждень
                {now.data ? (week === currentWeek ? ' · поточний' : ' · наступний') : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setWeek(week === 1 ? 2 : 1)}
              >
                Показати {ROMAN[week === 1 ? 2 : 1]} тиждень
              </button>
            </div>
          </section>

          {/* Swipe left/right here switches the day; the strip above stays the tap / a11y control.
              Re-keyed per day / week (and once loaded), so the new day's list rises in instead of a hard cut.
              min-h: a free day's short card would leave the blank space below it dead to swipes. */}
          <div ref={swipeRef} className="min-h-[40dvh]">
            <div key={`${week}-${day}-${isLoading}`} className="anim-rise">
              {isLoading ? (
                <Loading />
              ) : isError ? (
                <ErrorState error={error} onRetry={() => refetch()} title="Не вдалося завантажити розклад" />
              ) : dayLessons.length === 0 ? (
                <Empty
                  title="Пар немає"
                  hint={`${capitalize(selectedDate.format('dddd, D MMMM'))} — вільний день.`}
                  icon="calendar"
                />
              ) : (
                <section aria-label="Пари" className="flex flex-col gap-2.5">
                  {dayLessons.map((l, i) => {
                    const prev = dayLessons[i - 1];
                    // Free KPI slots between two lessons ("вікно").
                    const gaps = prev
                      ? KPI_PAIRS.filter(
                          (p) =>
                            toMin(p.start) >= toMin(prev.endTime) &&
                            toMin(p.end) <= toMin(l.startTime),
                        )
                      : [];
                    const start = toMin(l.startTime);
                    const end = toMin(l.endTime);
                    const isNow = isLiveDay && start <= nowMin && nowMin < end;
                    const isPast = isLiveDay && nowMin >= end;
                    return (
                      <Fragment key={l._id}>
                        {gaps.map((g) => (
                          <TimelineMark key={g.start} time={g.start} label="вікно" />
                        ))}
                        <LessonRow
                          l={l}
                          sameSlot={!!prev && prev.startTime === l.startTime && prev.endTime === l.endTime}
                          canManage={canManage}
                          past={isPast}
                          mark={week === currentWeek ? markOf(l._id) : undefined}
                          joinUrl={joinUrlOf(l)}
                          online={!!subjectOf(l.subjectId)?.isOnline}
                          live={
                            isNow
                              ? {
                                  left: end - nowMin,
                                  progress: Math.round(((nowMin - start) / (end - start)) * 100),
                                  ...liveExtras(l),
                                }
                              : undefined
                          }
                        />
                      </Fragment>
                    );
                  })}
                  <TimelineMark
                    time={endOfDay(dayLessons[dayLessons.length - 1].endTime)}
                    label="пар більше немає"
                  />
                </section>
              )}
            </div>
          </div>

          {/* Electives link — visible to students and heads, not teachers */}
          {!isTeacher && (
            <Link href="/schedule/electives" className="row justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="tile tile-soft h-10 w-10 rounded-[12px]">
                  <Icon name="star" size={20} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="h3 text-ink">Вибіркові дисципліни</span>
                  <span className="tiny faint">
                    {electives.data?.length
                      ? `Обрано ${enrolledCount} з ${electives.data.length} · впливає на ваш розклад`
                      : 'Оберіть, які вибіркові показувати в розкладі'}
                  </span>
                </div>
              </div>
              <Icon name="chevronRight" size={20} className="chev" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function TimelineMark({ time, label }: { time: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[50px] flex-shrink-0">
        <span className="num faint text-[13px]">{time}</span>
      </div>
      <div className="flex flex-1 items-center gap-2.5">
        <span className="h-0 flex-1 border-t border-dashed border-line-2" />
        <span className="tiny faint">{label}</span>
        <span className="h-0 flex-1 border-t border-dashed border-line-2" />
      </div>
    </div>
  );
}

function LessonRow({
  l,
  sameSlot,
  canManage,
  past,
  mark,
  joinUrl,
  online,
  live,
}: {
  l: Lesson;
  /** Same start/end as the row above (subgroups, electives): the time isn't repeated. */
  sameSlot?: boolean;
  canManage?: boolean;
  past?: boolean;
  /** The user's own attendance mark for this lesson (this week). */
  mark?: { label: string; title: string; cls: string };
  joinUrl?: string;
  /** The head marked the subject online (not inferred from the link). */
  online?: boolean;
  /** Set while the lesson is in progress. */
  live?: LiveInfo;
}) {
  const qc = useQueryClient();
  const toggleElective = useMutation({
    mutationFn: (isElective: boolean) =>
      api(`/schedule/lessons/${l._id}/elective`, {
        method: 'PATCH',
        json: { isElective },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['schedule-electives'] });
      qc.invalidateQueries({ queryKey: ['schedule-now'] });
    },
  });

  const typeLabel = TYPE_LABEL[l.type ?? 'other'] ?? TYPE_LABEL.other;
  const teachers = l.teacherNames.map(shortenName).join(', ');
  const meta = [l.groupName, l.room, teachers].filter(Boolean).join(' · ');

  // Head-only: a compact star instead of a text button on every card.
  const electiveTitle = l.isElective ? 'Зняти позначку «вибіркова»' : 'Позначити вибірковою';
  const electiveBtn = canManage ? (
    <button
      type="button"
      disabled={toggleElective.isPending}
      onClick={() => toggleElective.mutate(!l.isElective)}
      aria-pressed={!!l.isElective}
      aria-label={electiveTitle}
      title={electiveTitle}
      className={cn(
        'relative z-[1]',
        live
          ? cn(
              '-my-3 -mr-2 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl',
              l.isElective ? 'text-now-accent' : 'text-now-muted',
            )
          : cn('icon-btn-plain -my-2.5 -mr-2', l.isElective ? 'text-accent-text' : 'text-ink-3'),
      )}
    >
      <Icon name="star" size={18} className={l.isElective ? 'fill-current' : undefined} />
    </button>
  ) : null;
  const electiveError = toggleElective.isError ? (
    <span role="alert" className="chip chip-bad h-auto self-start whitespace-normal py-1">
      {toggleElective.error.message}
    </span>
  ) : null;

  return (
    <div className={cn('relative flex gap-3', sameSlot && '-mt-1', past && 'opacity-60')}>
      {/* Whole row opens the subject; buttons/links sit above this overlay. */}
      {l.subjectId ? (
        <Link
          href={`/subjects/${l.subjectId}`}
          aria-label={l.subjectName}
          className="absolute inset-0 rounded-2xl"
        />
      ) : null}

      <div className="flex w-[50px] flex-shrink-0 flex-col gap-0.5 pt-3.5">
        {sameSlot ? (
          <span className="sr-only">
            {l.startTime}–{l.endTime}
          </span>
        ) : (
          <>
            <span className={cn('num text-[13px]', live && 'text-accent-text')}>{l.startTime}</span>
            <span className="tiny faint">{l.endTime}</span>
          </>
        )}
      </div>

      {live ? (
        <div className="now flex min-w-0 flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[18px] font-bold leading-tight">{l.subjectName}</span>
            <span className="chip flex-shrink-0 gap-1.5 bg-now-accent text-now-accent-ink">
              <span className="dot bg-current" />
              ще {live.left} хв
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="small now-muted min-w-0" title={l.teacherNames.join(', ')}>
              {[typeLabel, l.isElective ? 'вибіркова' : '', online ? 'онлайн' : '', meta].filter(Boolean).join(' · ')}
            </span>
            {electiveBtn}
          </div>
          <div className="bar" aria-hidden="true">
            <span style={{ width: `${live.progress}%` }} />
          </div>
          {joinUrl || live.queue || live.hw ? (
            <div className="flex flex-wrap gap-2">
              {joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    'btn btn-now btn-md relative z-[1] min-w-[40%] flex-1',
                    // Three actions: join on its own row, queue + homework paired below.
                    live.queue && live.hw && 'basis-full',
                  )}
                >
                  <Icon name="video" strokeWidth={1.9} />
                  Приєднатись
                </a>
              ) : null}
              {live.queue ? (
                <Link
                  href={live.queue.href as Route}
                  className={cn(
                    'btn btn-md relative z-[1] min-w-[40%] flex-1',
                    joinUrl ? 'btn-now-ghost' : 'btn-now',
                  )}
                >
                  {live.queue.label}
                </Link>
              ) : null}
              {live.hw ? (
                <Link
                  href={live.hw.href as Route}
                  className="btn btn-now-ghost btn-md relative z-[1] min-w-[40%] flex-1"
                >
                  Завдання · {live.hw.count}
                </Link>
              ) : null}
            </div>
          ) : null}
          {electiveError}
        </div>
      ) : (
        <div className="card-flat flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="meta">
              <span className="chip">{typeLabel}</span>
              {mark ? (
                <span className={cn('chip', mark.cls)} title={mark.title}>
                  {mark.label}
                </span>
              ) : null}
              {l.isElective ? <span className="chip chip-accent">вибіркова</span> : null}
              {online ? <span className="chip chip-info">онлайн</span> : null}
            </div>
            {electiveBtn}
          </div>
          <span className="h3">{l.subjectName}</span>
          {meta || joinUrl ? (
            <div className="flex items-center justify-between gap-2">
              <span className="small muted min-w-0" title={l.teacherNames.join(', ')}>
                {meta}
              </span>
              {joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm relative z-[1] -my-2.5 -mr-2 flex-shrink-0 gap-1 px-2"
                >
                  {meetingLabel(joinUrl)}
                  <Icon name="arrowUpRight" size={14} strokeWidth={2.2} />
                </a>
              ) : null}
            </div>
          ) : null}
          {electiveError}
        </div>
      )}
    </div>
  );
}

/**
 * "Сесія" view — vertical list of upcoming exams grouped by month.
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
    return <Loading />;
  }
  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => query.refetch()}
        title="Не вдалося завантажити розклад сесії"
      />
    );
  }
  if (all.length === 0) {
    return (
      <Empty
        title="Розкладу сесії ще немає"
        hint="Кампус ще не опублікував розклад сесії для цієї групи."
        icon="calendarCheck"
      />
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
    <div className="flex flex-col gap-5">
      {[...groups.entries()].map(([month, list]) => (
        <Section key={month} title={formatMonthLabel(month)}>
          <div className="flex flex-col gap-2.5">
            {list.map((s) => (
              <SessionCard key={s._id} s={s} />
            ))}
          </div>
        </Section>
      ))}
      {!showPast && past > 0 ? (
        <button
          type="button"
          className="btn btn-secondary btn-md btn-block"
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
  const meta = [s.room, s.teacherNames?.join(', ')].filter(Boolean).join(' · ');
  const card = (
    <div className={cn('card-flat flex items-start gap-3 p-3.5', isPast && 'opacity-60')}>
      <div className="flex w-12 flex-shrink-0 flex-col items-center gap-0.5 rounded-xl bg-surface-2 py-2">
        <span className="eyebrow text-[10px]">{date.format('MMM')}</span>
        <span className="num text-[20px] leading-none">{date.format('DD')}</span>
        <span className="tiny faint">{date.format('dd')}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="meta">
          <span className={cn('chip', SESSION_TYPE_TONE[s.type])}>
            {SESSION_TYPE_LABEL[s.type]}
          </span>
          {s.startTime ? (
            <span className="num tiny muted whitespace-nowrap">
              {s.startTime}
              {s.endTime ? `–${s.endTime}` : ''}
            </span>
          ) : null}
          {s.groupName ? <span className="tiny faint">{s.groupName}</span> : null}
        </div>
        <span className="h3">{s.subjectName}</span>
        {meta ? <span className="small muted truncate">{meta}</span> : null}
      </div>
    </div>
  );

  if (s.subjectId) {
    return (
      <Link href={`/subjects/${s.subjectId}` as unknown as never} className="block">
        {card}
      </Link>
    );
  }
  return card;
}

function formatMonthLabel(month: string): string {
  const d = dayjs(`${month}-01`);
  // "Січень 2026"
  return `${capitalize(d.format('MMMM'))} ${d.format('YYYY')}`;
}
