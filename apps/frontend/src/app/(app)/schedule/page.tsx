'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Icon } from '../../../components/icons';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Section } from '../../../components/ui/Section';
import { cn } from '../../../lib/cn';
import { shortenName } from '../../../lib/name';
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

  const isLiveDay = !!now.data && week === currentWeek && clock.day() === day;
  const nowMin = clock.hour() * 60 + clock.minute();

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
            <button
              type="button"
              className="btn btn-outline btn-md"
              onClick={() => setView('sessions')}
            >
              <Icon name="calendarCheck" size={18} />
              Сесія
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-md"
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
            <div className="flex gap-1.5">
              {WEEKDAYS.map((w, i) => {
                const d = i + 1;
                const isToday = d === today && week === currentWeek;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    aria-pressed={day === d}
                    className={cn('day flex-1', day === d && 'on', isToday && 'today')}
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
                {now.data && week === currentWeek ? ' · поточний' : ''}
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
                      canManage={canManage}
                      past={isPast}
                      live={
                        isNow
                          ? {
                              left: end - nowMin,
                              progress: Math.round(((nowMin - start) / (end - start)) * 100),
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
                      : 'Обери, які вибіркові відображати в розкладі'}
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
  canManage,
  past,
  live,
}: {
  l: Lesson;
  canManage?: boolean;
  past?: boolean;
  /** Set while the lesson is in progress: minutes left and % elapsed. */
  live?: { left: number; progress: number };
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

  const electiveBtn = canManage ? (
    <>
      <button
        type="button"
        disabled={toggleElective.isPending}
        onClick={() => toggleElective.mutate(!l.isElective)}
        className={cn(
          'btn relative z-[1] self-start',
          live ? 'btn-now-ghost btn-md' : 'btn-ghost btn-sm px-1',
          !live && !l.isElective && 'text-ink-3',
        )}
      >
        <Icon name="star" size={14} className={l.isElective ? 'fill-current' : undefined} />
        {l.isElective ? 'Вибіркова' : 'Позначити вибірковою'}
      </button>
      {toggleElective.isError ? (
        <span role="alert" className="chip chip-bad h-auto self-start whitespace-normal py-1">
          {toggleElective.error.message}
        </span>
      ) : null}
    </>
  ) : null;

  return (
    <div className={cn('relative flex gap-3', past && 'opacity-60')}>
      {/* Whole row opens the subject; buttons/links sit above this overlay. */}
      {l.subjectId ? (
        <Link
          href={`/subjects/${l.subjectId}`}
          aria-label={l.subjectName}
          className="absolute inset-0 rounded-2xl"
        />
      ) : null}

      <div className="flex w-[50px] flex-shrink-0 flex-col gap-0.5 pt-3.5">
        <span className={cn('num text-[13px]', live && 'text-accent-text')}>{l.startTime}</span>
        <span className="tiny faint">{l.endTime}</span>
      </div>

      {live ? (
        <div className="now flex min-w-0 flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[18px] font-bold leading-tight">{l.subjectName}</span>
            <span className="chip flex-shrink-0 gap-1.5 bg-now-accent text-now-accent-ink">
              <span className="dot bg-current" />
              зараз · ще {live.left} хв
            </span>
          </div>
          <span className="small now-muted" title={l.teacherNames.join(', ')}>
            {[typeLabel, l.isElective ? 'вибіркова' : '', meta].filter(Boolean).join(' · ')}
          </span>
          <div className="bar" aria-hidden="true">
            <span style={{ width: `${live.progress}%` }} />
          </div>
          {l.meetingUrl || electiveBtn ? (
            <div className="flex flex-wrap items-center gap-2">
              {l.meetingUrl ? (
                <a
                  href={l.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-now btn-md relative z-[1] flex-1"
                >
                  {meetingLabel(l.meetingUrl)}
                  <Icon name="arrowUpRight" size={16} />
                </a>
              ) : null}
              {electiveBtn}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card-flat flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
          <div className="meta">
            <span className="chip">{typeLabel}</span>
            {l.isElective ? <span className="chip chip-accent">вибіркова</span> : null}
            {l.meetingUrl ? <span className="chip chip-info">онлайн</span> : null}
          </div>
          <span className="h3">{l.subjectName}</span>
          {meta || l.meetingUrl ? (
            <div className="flex items-center justify-between gap-2">
              <span className="small muted min-w-0" title={l.teacherNames.join(', ')}>
                {meta}
              </span>
              {l.meetingUrl ? (
                <a
                  href={l.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm relative z-[1] -mr-2 flex-shrink-0 gap-1 px-2"
                >
                  {meetingLabel(l.meetingUrl)}
                  <Icon name="arrowUpRight" size={14} strokeWidth={2.2} />
                </a>
              ) : null}
            </div>
          ) : null}
          {electiveBtn}
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
