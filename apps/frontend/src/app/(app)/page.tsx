'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { focusManager, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { api, setActiveGroup } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../components/Empty';
import { Section } from '../../components/ui/Section';
import { Icon, Logo, type IconName } from '../../components/icons';
import { SubjectTile } from '../../components/SubjectIcon';
import { UserAvatar, myAvatarUrl } from '../../components/UserAvatar';
import {
  isQueueOpen,
  queueBySubject,
  takenSlots,
  type RawQueue,
} from '../../components/subjects/helpers';
import { cn } from '../../lib/cn';
import { shortenName, subjectAcronym, vocative } from '../../lib/name';
import { useActiveMembership, useCanManage, useIsTeacherOnly, useMe } from '../../hooks/useMe';
import { getWebApp, haptic } from '../../lib/telegram';
import { timeAgo } from '../../lib/time';

interface MySubject {
  _id: string;
  name: string;
  shortName?: string;
  icon?: string;
  groupId: string;
  groupName: string;
  groupStudentCount?: number;
  activeHomework?: number;
}

interface GroupOption {
  _id: string;
  academicName: string;
}

interface MyJoinRequest {
  _id: string;
  groupId: string;
  groupName: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
}

interface IdentifyResult {
  matched: boolean;
  lecturerId?: string;
  lecturerName?: string;
  linked: number;
  candidates?: Array<{ id: string; name: string }>;
}

interface SubjectSummary {
  _id: string;
  name: string;
  shortName?: string;
  icon?: string;
  teachers: Array<{ fullName: string }>;
  links?: Array<{ url: string; showInLessonReminder?: boolean; lessonReminderType?: string }>;
  settings?: { hideQueue?: boolean };
}

/** A lesson as returned by /schedule/now, /schedule/my, /schedule/group-week and the lecturer endpoints. */
interface Lesson {
  _id: string;
  subjectId?: string;
  dayOfWeek: number;
  lessonNumber?: number;
  subjectName: string;
  startTime: string;
  endTime: string;
  type?: string;
  room?: string;
  meetingUrl?: string;
  groupName?: string;
  teacherNames?: string[];
}

interface NowResponse {
  current: Lesson | null;
  next: Lesson | null;
  weekType?: 1 | 2;
}

interface PendingHw {
  _id: string;
  title: string;
  deadline?: string;
  subjectName?: string;
  points?: number;
}

type AttStatus = 'present' | 'absent' | 'late' | 'excused' | 'unknown';

interface MyMark {
  lessonId: string;
  status: AttStatus;
}

interface WeekGrid {
  students: Array<{ _id: string }>;
  perLessonWeek: Record<string, { present: number; absent: number; excused: number; late: number }>;
}

interface GroupJoinRequest {
  _id: string;
  fullName: string;
}

const TYPE_LABEL: Record<string, string> = {
  lecture: 'Лекція',
  practice: 'Практика',
  lab: 'Лабораторна',
  seminar: 'Семінар',
  other: 'Інше',
};

/** What the teacher does in a subject, by the lesson types they hold (mockup 21). */
const KIND_LABEL: Record<string, string> = {
  lecture: 'Лектор',
  lab: 'Лабораторні',
  practice: 'Практики',
  seminar: 'Семінари',
};

const ATT_CHIP: Partial<Record<AttStatus, { label: string; cls: string }>> = {
  present: { label: 'П', cls: 'chip-ok' },
  late: { label: 'Зап', cls: 'chip-info' },
  excused: { label: 'Пов', cls: 'chip-warn' },
  absent: { label: 'Н', cls: 'chip-bad' },
};

const ROLE_LABEL: Record<string, string> = {
  group_head: 'Староста',
  deputy_head: 'Заступник',
  admin: 'Адмін',
};

export default function HomePage() {
  const isTeacherOnly = useIsTeacherOnly();
  if (isTeacherOnly) return <TeacherHomePage />;
  return <StudentHomePage />;
}

// ── Teacher ──────────────────────────────────────────────────────────────────

function TeacherHomePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useMe();
  const nowMin = useNowMinutes();

  const [identifyName, setIdentifyName] = useState('');
  const [identifyError, setIdentifyError] = useState('');
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string }>>([]);
  const [autoTried, setAutoTried] = useState(false);

  // Pre-fill the name input from the user's profile
  useEffect(() => {
    if (me.data && !identifyName) {
      const name =
        me.data.fullName ||
        [me.data.firstName, me.data.lastName].filter(Boolean).join(' ');
      setIdentifyName(name);
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const mySubjects = useQuery({
    queryKey: ['teacher-my-subjects'],
    queryFn: () => api<MySubject[]>('/teachers/my-subjects'),
    enabled: !!me.data?.campusLecturerId,
  });

  // Teacher's "now / next lesson" — live from Campus.
  const lecturerNow = useQuery({
    queryKey: ['lecturer-now'],
    queryFn: () => api<NowResponse>('/schedule/lecturer/now'),
    retry: 0,
    enabled: !!me.data?.campusLecturerId,
  });
  useRefetchAtBoundary(lecturerNow.data, nowMin, lecturerNow.refetch);

  const identify = useMutation({
    mutationFn: (body: { name?: string; lecturerId?: string }) =>
      api<IdentifyResult>('/teachers/identify', { method: 'POST', json: body }),
    onSuccess: (result) => {
      if (result.matched) {
        haptic('success');
        setIdentifyError('');
        setCandidates([]);
        qc.invalidateQueries({ queryKey: ['me'] });
        qc.invalidateQueries({ queryKey: ['teacher-my-subjects'] });
      } else if (result.candidates?.length) {
        setCandidates(result.candidates);
        setIdentifyError('Оберіть ваш профіль зі списку або спробуйте інше написання.');
      } else {
        setIdentifyError(
          'Не знайдено у базі Кампус КПІ. Перевірте написання ПІБ — воно має збігатися з офіційним.',
        );
        haptic('error');
      }
    },
    onError: (err: Error) => {
      setIdentifyError(err.message);
      haptic('error');
    },
  });

  // Every subject jump switches the active group first — the subject lives there.
  const openIn = (s: MySubject, href: string) => {
    haptic('selection');
    setActiveGroup(s.groupId);
    router.push(href as Route);
  };
  const openSubject = (s: MySubject) => openIn(s, `/subjects/${s._id}`);

  // Auto-identify verified teachers (they're in Викладачі sheet → fullName
  // is pre-filled from the sheet on auth → kick off the Campus lookup
  // automatically so they go straight to the subjects screen, no extra clicks).
  useEffect(() => {
    if (
      me.data &&
      !me.data.campusLecturerId &&
      me.data.fullName &&
      !autoTried &&
      !identify.isPending
    ) {
      setAutoTried(true);
      identify.mutate({ name: me.data.fullName });
    }
  }, [me.data, autoTried, identify.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjects = useMemo(() => mySubjects.data ?? [], [mySubjects.data]);
  const byGroup = useMemo(() => {
    const map = new Map<string, { groupName: string; students?: number; items: MySubject[] }>();
    for (const s of subjects) {
      const g = map.get(s.groupId) ?? { groupName: s.groupName, students: s.groupStudentCount, items: [] };
      g.items.push(s);
      map.set(s.groupId, g);
    }
    return [...map.entries()];
  }, [subjects]);

  // Queue state per subject (open / opens on / how many waiting): one GET /queues per group.
  const groupQueues = useQueries({
    queries: byGroup.map(([groupId]) => ({
      queryKey: ['teacher-queues', groupId],
      queryFn: () => api<RawQueue[]>('/queues', { query: { groupId } }),
      retry: 0,
    })),
  });
  const queueOf = new Map<string, RawQueue>();
  for (const q of groupQueues) for (const [id, v] of queueBySubject(q.data)) queueOf.set(id, v);

  // «Лектор · Лабораторні» per subject: lesson kinds from both weeks (same cache as Розклад).
  const weeks = useQueries({
    queries: ([1, 2] as const).map((week) => ({
      queryKey: ['schedule', week, true],
      queryFn: () => api<Lesson[]>('/schedule/lecturer/week', { query: { week } }),
      enabled: !!me.data?.campusLecturerId,
      retry: 0,
    })),
  });
  const kindsOf = new Map<string, Set<string>>();
  for (const w of weeks)
    for (const l of w.data ?? [])
      if (l.subjectId && l.type) kindsOf.set(l.subjectId, (kindsOf.get(l.subjectId) ?? new Set()).add(l.type));

  // ── Identification screen ──────────────────────────────────────────────────
  if (!me.data?.campusLecturerId) {
    const prefilledFromSheet = !!me.data?.fullName;
    // While auto-identify is in flight (and hasn't returned candidates), show
    // a clean loader instead of the "fill ПІБ" form.
    const autoIdentifying = prefilledFromSheet && identify.isPending && candidates.length === 0;
    return (
      <div className="flex min-h-[calc(100dvh-42px)] flex-col gap-5 pt-2.5">
        <header className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <Logo size={36} />
            <span className="eyebrow text-ink-2">FICE Helper · для викладачів</span>
          </div>
          <h1 className="h1 text-[24px]">Підключимо ваші дисципліни з Кампус КПІ</h1>
          {autoIdentifying ? null : (
            <p className="leading-normal text-ink-2">
              {prefilledFromSheet
                ? 'Ми взяли ваше ПІБ з таблиці викладачів. Перевірте написання — воно має збігатися з офіційним — і ми знайдемо ваші курси в розкладі.'
                : 'Вкажіть ваше ПІБ у форматі «Прізвище Ім\'я По-батькові» — система автоматично знайде ваші дисципліни в розкладі.'}
            </p>
          )}
        </header>

        {autoIdentifying ? (
          <Loading label="Підключення до Кампус КПІ…" />
        ) : (
          <>
            <section className="card flex flex-col gap-3.5">
              <div>
                <label className="label" htmlFor="t-name">
                  ПІБ як у Кампусі
                </label>
                <input
                  id="t-name"
                  className="input"
                  value={identifyName}
                  onChange={(e) => setIdentifyName(e.target.value)}
                  placeholder="Прізвище Ім'я По-батькові"
                />
                <div className="hint">Прізвище Імʼя По-батькові, без скорочень</div>
              </div>

              {identifyError && !candidates.length ? <div className="small text-bad">{identifyError}</div> : null}

              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={identify.isPending || !identifyName.trim()}
                onClick={() => {
                  setCandidates([]);
                  setIdentifyError('');
                  identify.mutate({ name: identifyName.trim() });
                }}
              >
                <Icon name="search" />
                {identify.isPending && !candidates.length ? 'Пошук…' : 'Знайти дисципліни'}
              </button>
            </section>

            {candidates.length > 0 ? (
              <Section
                title={`Знайдено ${candidates.length} ${pluralUk(candidates.length, ['профіль', 'профілі', 'профілів'])}`}
                aside={<span className="tiny faint">оберіть свій</span>}
              >
                {candidates.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className={cn('row w-full justify-between text-left', i === 0 && 'border-accent')}
                    disabled={identify.isPending}
                    onClick={() => {
                      setCandidates([]);
                      setIdentifyError('');
                      identify.mutate({ lecturerId: c.id });
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <UserAvatar name={c.name} className={cn(i === 0 && 'bg-accent-soft text-accent-text')} />
                      <span className="h3 min-w-0">{c.name}</span>
                    </span>
                    <span className={cn('chip flex-shrink-0', i === 0 && 'chip-accent')}>Це я</span>
                  </button>
                ))}
              </Section>
            ) : null}

            <div className="mt-auto flex flex-col items-center gap-2.5 px-3 pt-2 text-center">
              <span className="small muted">
                Не бачите себе? Староста групи ще могла не додати вас до дисципліни — або напишіть у
                підтримку.
              </span>
              {/* /support lives in the bot chat: closing the Mini App lands the user there. */}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => getWebApp()?.close()}>
                Написати в підтримку · /support
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Subjects screen ────────────────────────────────────────────────────────
  const current = lecturerNow.data?.current ?? null;
  const next = lecturerNow.data?.next ?? null;
  const currentSubject = current?.subjectId
    ? subjects.find((s) => s._id === current.subjectId)
    : undefined;
  const currentQueue = currentSubject ? queueOf.get(currentSubject._id) : undefined;
  const inQueue = currentQueue && isQueueOpen(currentQueue) ? waitingCount(currentQueue) : 0;
  const nextSubject = next?.subjectId ? subjects.find((s) => s._id === next.subjectId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <HomeHeader
        title="Мої дисципліни"
        weekType={lecturerNow.data?.weekType}
        label="Викладач"
        accentLabel
      />

      {current ? (
        <NowCard
          lesson={current}
          nowMin={nowMin}
          meta={joinParts([
            current.groupName,
            current.type ? TYPE_LABEL[current.type] : null,
            current.room ? `ауд. ${current.room}` : null,
            inQueue ? `у черзі ${inQueue}` : null,
          ])}
          actions={
            <>
              {currentSubject ? (
                <>
                  <button
                    type="button"
                    className="btn btn-now min-w-max flex-[1.2]"
                    onClick={() => openIn(currentSubject, `/subjects/${currentSubject._id}/queue`)}
                  >
                    Черга на захист
                  </button>
                  <button
                    type="button"
                    className="btn btn-now-ghost min-w-max flex-1"
                    onClick={() => openIn(currentSubject, journalHref(currentSubject))}
                  >
                    Журнал
                  </button>
                </>
              ) : null}
              {current.meetingUrl ? (
                <a
                  href={current.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-now-ghost min-w-max flex-1"
                >
                  <Icon name="video" strokeWidth={1.9} />
                  Приєднатись
                </a>
              ) : null}
            </>
          }
        />
      ) : null}

      {next ? (
        <NextRow
          nowMin={nowMin}
          lesson={next}
          title={joinParts([
            nextSubject?.shortName || subjectAcronym(next.subjectName),
            next.type ? TYPE_LABEL[next.type]?.toLowerCase() : null,
            next.groupName,
          ])}
          parts={[next.room]}
        />
      ) : null}

      {mySubjects.isLoading ? (
        <Loading />
      ) : mySubjects.isError && !mySubjects.data ? (
        <ErrorState error={mySubjects.error} onRetry={() => mySubjects.refetch()} />
      ) : subjects.length === 0 ? (
        <Empty
          icon="book"
          title="Дисципліни не знайдено"
          hint="Старости груп ще не створили дисципліни або ще не додали вас до них. Як тільки вони це зроблять — дисципліни з'являться тут автоматично."
        />
      ) : (
        <Section
          title="Дисципліни за групами"
          aside={
            <span className="tiny faint">
              {byGroup.length} {pluralUk(byGroup.length, ['група', 'групи', 'груп'])}
            </span>
          }
        >
          {byGroup.map(([groupId, g]) => (
            <div key={groupId} className="card-flat flex flex-col px-3.5 py-1">
              <div className="row-plain min-h-10 pt-2.5">
                <span className="eyebrow">
                  {g.groupName}
                  {g.students ? ` · ${g.students} ${pluralUk(g.students, ['студент', 'студенти', 'студентів'])}` : ''}
                </span>
              </div>
              {g.items.map((s, i) => {
                const kinds = kindsOf.get(s._id);
                const sub = joinParts([
                  ...Object.keys(KIND_LABEL)
                    .filter((k) => kinds?.has(k))
                    .map((k) => KIND_LABEL[k]),
                  queueLine(queueOf.get(s._id)),
                  s.activeHomework
                    ? `${s.activeHomework} ${pluralUk(s.activeHomework, ['завдання активне', 'завдання активні', 'завдань активних'])}`
                    : null,
                ]);
                return (
                  <Fragment key={s._id}>
                    {i > 0 ? <div className="divider" /> : null}
                    <button
                      type="button"
                      className="row-plain w-full justify-between text-left"
                      onClick={() => openSubject(s)}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <SubjectTile name={s.name} icon={s.icon} />
                        <span className="flex min-w-0 flex-col">
                          <span className="h3 truncate">{s.name}</span>
                          {sub ? <span className="tiny faint line-clamp-2">{sub}</span> : null}
                        </span>
                      </span>
                      <Icon name="chevronRight" className="chev" />
                    </button>
                  </Fragment>
                );
              })}
            </div>
          ))}
        </Section>
      )}

      {/* Self-service: request read-only access to another group's queue */}
      <TeacherJoinSection />
    </div>
  );
}

/** Same journal link the subject page builds: /attendance filtered to one subject. */
function journalHref(s: MySubject): string {
  const params = new URLSearchParams({
    subjectIds: s._id,
    subjectName: s.name,
    subjectShortName: s.shortName ?? '',
  });
  return `/attendance?${params.toString()}`;
}

/**
 * Teacher → "Додати групу": send a join request to another group's head so the
 * teacher gets read-only access to that group's queue (per user's clarification:
 * "тільки тієї якої попросить у групи" + "тільки переглядати").
 */
function TeacherJoinSection() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<GroupOption | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const myRequests = useQuery({
    queryKey: ['my-join-requests'],
    queryFn: () => api<MyJoinRequest[]>('/teachers/join-request/mine'),
  });

  const groups = useQuery({
    queryKey: ['groups-search', search],
    queryFn: () => api<GroupOption[]>('/groups/search', { query: { q: search } }),
    enabled: open,
  });

  const submit = useMutation({
    mutationFn: (groupId: string) =>
      api('/teachers/join-request', {
        method: 'POST',
        json: { groupId, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      haptic('success');
      setOpen(false);
      setPicked(null);
      setNote('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['my-join-requests'] });
    },
    onError: (e: Error) => {
      setError(e.message);
      haptic('error');
    },
  });

  const pending = (myRequests.data ?? []).filter((r) => r.status === 'pending');

  return (
    <section className="card-flat flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="h3">Доступ до іншої групи</span>
          <span className="tiny faint">Запит старості · ви отримаєте перегляд черг</span>
        </div>
        {!open && !picked ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm flex-shrink-0"
            onClick={() => setOpen(true)}
          >
            + Додати
          </button>
        ) : null}
      </div>

      {pending.map((r) => (
        <div
          key={r._id}
          className="flex min-h-11 items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2"
        >
          <span className="small">
            <span className="font-semibold">{r.groupName}</span>{' '}
            <span className="muted">· очікує підтвердження старости</span>
          </span>
          <span className="dot animate-pulse bg-warn" />
        </div>
      ))}

      {open && !picked ? (
        <div className="flex flex-col gap-2">
          <input
            className="input"
            placeholder="Пошук групи (ІП-41, УВ-з51ф…)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {groups.isLoading ? (
            <div className="tiny faint px-1">Завантаження…</div>
          ) : groups.isError ? (
            <div className="tiny px-1 text-bad">{groups.error.message}</div>
          ) : (groups.data ?? []).length === 0 ? (
            <div className="tiny faint px-1">Групи не знайдено</div>
          ) : (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {(groups.data ?? []).map((g) => (
                <button
                  key={g._id}
                  type="button"
                  className="small min-h-11 w-full rounded-[12px] bg-surface-2 px-3 text-left font-semibold"
                  onClick={() => setPicked(g)}
                >
                  {g.academicName}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm self-start"
            onClick={() => {
              setOpen(false);
              setSearch('');
            }}
          >
            Скасувати
          </button>
        </div>
      ) : null}

      {picked ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 rounded-[12px] bg-accent-soft py-1 pl-3 pr-1 text-accent-text">
            <div className="min-w-0">
              <div className="small font-semibold">{picked.academicName}</div>
              <div className="tiny">Обрана група</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
              Змінити
            </button>
          </div>
          <textarea
            className="textarea"
            placeholder="Коротко: яка саме дисципліна / навіщо доступ (необов'язково)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error ? <div className="small text-bad">{error}</div> : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => {
                setOpen(false);
                setPicked(null);
                setError(null);
              }}
            >
              Скасувати
            </button>
            <button
              type="button"
              className="btn btn-primary flex-[2]"
              disabled={submit.isPending}
              onClick={() => submit.mutate(picked._id)}
            >
              {submit.isPending ? 'Надсилаємо…' : 'Надіслати запит'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ── Student / head / deputy ──────────────────────────────────────────────────

function StudentHomePage() {
  const qc = useQueryClient();
  const canManage = useCanManage();
  const me = useMe();
  const membership = useActiveMembership();
  const nowMin = useNowMinutes();
  const today = ((new Date().getDay() + 6) % 7) + 1; // Mon=1..Sun=7
  const weekIso = useMemo(() => {
    const d = dayjs();
    return d.subtract((d.day() + 6) % 7, 'day').format('YYYY-MM-DD');
  }, []);

  const hwPending = useQuery({
    queryKey: ['hw-pending-count'],
    queryFn: () => api<PendingHw[]>('/homework/my/pending'),
  });
  const now = useQuery({
    queryKey: ['schedule-now'],
    queryFn: () => api<NowResponse>('/schedule/now'),
  });
  useRefetchAtBoundary(now.data, nowMin, now.refetch);
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectSummary[]>('/subjects'),
  });
  const week = now.data?.weekType;
  // Students: own timetable (electives filtered) — same cache as the Розклад tab.
  const myWeek = useQuery({
    queryKey: ['schedule', week, false],
    queryFn: () => api<Lesson[]>('/schedule/my', { query: { week } }),
    enabled: !!week && !canManage,
  });
  const myMarks = useQuery({
    queryKey: ['attendance', 'my'],
    queryFn: () => api<MyMark[]>('/attendance/my'),
    enabled: !canManage,
  });
  // Managers: the whole group's day (same cache as the mark screen) + the journal grid.
  const groupWeek = useQuery({
    queryKey: ['schedule-group-week', week],
    queryFn: () => api<Lesson[]>('/schedule/group-week', { query: { week: String(week) } }),
    enabled: !!week && canManage,
  });
  const grid = useQuery({
    // Same key as the unfiltered journal grid (third element = subject filter).
    queryKey: ['attendance-grid', weekIso, null],
    queryFn: () => api<WeekGrid>('/attendance/week-grid', { query: { weekStart: weekIso } }),
    enabled: canManage,
  });
  const groupId = membership?.groupId;
  const joinRequests = useQuery({
    queryKey: ['teacher-join-requests', groupId],
    queryFn: () => api<GroupJoinRequest[]>('/teachers/join-requests', { query: { groupId } }),
    enabled: canManage && !!groupId,
  });
  // Same caches as the Предмети tab / electives / group settings screens.
  const queues = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<RawQueue[]>('/queues'),
  });
  const electives = useQuery({
    queryKey: ['schedule-electives'],
    queryFn: () => api<unknown[]>('/schedule/electives'),
    enabled: canManage,
  });
  const groupSettings = useQuery({
    queryKey: ['group-settings'],
    queryFn: () => api<{ campusGroupId?: string; scheduleSyncedAt?: string }>('/groups/current/settings'),
    enabled: canManage,
  });

  const complete = useMutation({
    mutationFn: (id: string) =>
      api(`/homework/${id}/completion`, { method: 'PATCH', json: { done: true } }),
    onSuccess: (_res, id) => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['hw', id] });
      qc.invalidateQueries({ queryKey: ['hw-all'] });
      qc.invalidateQueries({ queryKey: ['subject-hw'] });
      // Stay pending (box ticked) until the row actually leaves the list.
      return qc.invalidateQueries({ queryKey: ['hw-pending-count'] });
    },
    onError: () => haptic('error'),
  });

  const lessonsQ = canManage ? groupWeek : myWeek;
  const todayLessons = useMemo(
    () =>
      (lessonsQ.data ?? [])
        .filter((l) => l.dayOfWeek === today)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [lessonsQ.data, today],
  );
  const myMarkByLesson = useMemo(
    () => new Map((myMarks.data ?? []).map((m) => [m.lessonId, m.status])),
    [myMarks.data],
  );

  const pendingCount = hwPending.data?.length ?? 0;
  const hwFailed = hwPending.isError && !hwPending.data;
  const lessonsFailed = (now.isError && !now.data) || (lessonsQ.isError && !lessonsQ.data);
  const deadlines = useMemo(
    () =>
      [...(hwPending.data ?? [])]
        .sort((a, b) =>
          a.deadline && b.deadline
            ? a.deadline.localeCompare(b.deadline)
            : a.deadline
              ? -1
              : b.deadline
                ? 1
                : 0,
        )
        .slice(0, 3),
    [hwPending.data],
  );

  const current = now.data?.current ?? null;
  const next = now.data?.next ?? null;
  const currentSubject = current?.subjectId
    ? subjects.data?.find((s) => s._id === current.subjectId)
    : undefined;
  const joinUrl =
    current?.meetingUrl ??
    currentSubject?.links?.find(
      (l) => l.showInLessonReminder && (!l.lessonReminderType || l.lessonReminderType === current?.type),
    )?.url;
  const queueHref =
    current?.subjectId && (canManage || !currentSubject?.settings?.hideQueue)
      ? (`/subjects/${current.subjectId}/queue` as Route)
      : null;

  const myId = me.data?._id;
  const queueMap = useMemo(() => queueBySubject(queues.data), [queues.data]);
  const currentQueue = current?.subjectId ? queueMap.get(current.subjectId) : undefined;
  const currentSpot = currentQueue && myId ? queueSpot(currentQueue, myId) : null;
  const queueLabel = !currentQueue
    ? 'Черга'
    : canManage
      ? `Черга ${takenSlots(currentQueue)}/${currentQueue.slotsCount}`
      : currentSpot
        ? `Черга · ви ${currentSpot.place}-й`
        : isQueueOpen(currentQueue)
          ? `Черга · ${takenSlots(currentQueue)}/${currentQueue.slotsCount}`
          : 'Черга';
  // Quick tile: the queue I'm waiting in (the current lesson's first, else the nearest turn).
  const { myQueue, openQueues } = useMemo(() => {
    const mine: Array<{ subjectId: string; name: string; slot: number; place: number }> = [];
    let open = 0;
    for (const [subjectId, q] of queueMap) {
      const s = subjects.data?.find((x) => x._id === subjectId);
      if (s?.settings?.hideQueue) continue;
      if (isQueueOpen(q)) open++;
      const spot = myId ? queueSpot(q, myId) : null;
      if (spot) mine.push({ subjectId, name: s?.shortName || subjectAcronym(s?.name ?? ''), ...spot });
    }
    const isNow = (x: { subjectId: string }) => Number(x.subjectId === current?.subjectId);
    mine.sort((a, b) => isNow(b) - isNow(a) || a.place - b.place);
    return { myQueue: mine[0] ?? null, openQueues: open };
  }, [queueMap, subjects.data, myId, current?.subjectId]);
  const queuesFailed = queues.isError && !queues.data;

  const studentsCount = grid.data?.students.length ?? 0;
  const lessonStats = (id: string) => grid.data?.perLessonWeek[id];
  const presence = useMemo(() => {
    let present = 0;
    let total = 0;
    for (const s of Object.values(grid.data?.perLessonWeek ?? {})) {
      present += s.present + s.late;
      total += s.present + s.late + s.absent + s.excused;
    }
    return total ? Math.round((present / total) * 100) : null;
  }, [grid.data]);
  const requests = joinRequests.data ?? [];

  const firstName = me.data?.firstName;

  return (
    <div className="flex flex-col gap-4">
      <HomeHeader
        title={firstName ? `Привіт, ${vocative(firstName)}` : 'Привіт'}
        weekType={week}
        label={canManage ? ROLE_LABEL[membership?.role ?? ''] ?? '' : membership?.groupName ?? ''}
        accentLabel={canManage}
      />

      {current ? (
        <NowCard
          lesson={current}
          nowMin={nowMin}
          meta={joinParts([
            current.lessonNumber ? `${current.lessonNumber} пара` : null,
            current.type ? TYPE_LABEL[current.type] : null,
            current.room ? `ауд. ${current.room}` : null,
            canManage
              ? grid.data && !lessonStats(current._id)
                ? 'присутність ще не відмічена'
                : null
              : current.teacherNames?.[0]
                ? shortenName(current.teacherNames[0])
                : null,
          ])}
          actions={
            <>
              {canManage ? (
                <Link href="/attendance/mark" className="btn btn-now min-w-max flex-[1.3]">
                  <Icon name="checkSquare" />
                  Відмітити присутніх
                </Link>
              ) : null}
              {joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn('btn min-w-max flex-1', canManage ? 'btn-now-ghost' : 'btn-now')}
                >
                  <Icon name="video" strokeWidth={1.9} />
                  Приєднатись
                </a>
              ) : null}
              {queueHref ? (
                <Link
                  href={queueHref}
                  className={cn(
                    'btn min-w-max flex-1',
                    canManage || joinUrl ? 'btn-now-ghost' : 'btn-now',
                  )}
                >
                  {queueLabel}
                </Link>
              ) : null}
            </>
          }
        />
      ) : null}

      {next ? (
        <NextRow
          nowMin={nowMin}
          lesson={next}
          title={next.subjectName}
          parts={[
            next.type ? TYPE_LABEL[next.type] : null,
            next.room && !canManage ? `ауд. ${next.room}` : next.room,
          ]}
        />
      ) : null}

      {canManage ? (
        <Section
          title="Керування групою"
          aside={
            membership?.groupName ? (
              <span className="chip chip-accent">
                {membership.groupName}
                {studentsCount
                  ? ` · ${studentsCount} ${pluralUk(studentsCount, ['студент', 'студенти', 'студентів'])}`
                  : ''}
              </span>
            ) : null
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <ManageTile
              href="/attendance"
              icon="list"
              title="Журнал"
              hint={presence !== null ? `цього тижня ${presence}% присутності` : 'Відвідуваність групи'}
            />
            <ManageTile
              href="/settings/group"
              icon="users"
              title="Запити викладачів"
              hint={
                requests.length
                  ? `${requests.length} ${pluralUk(requests.length, ['новий', 'нові', 'нових'])} · ${shortenName(requests[0].fullName)}`
                  : 'нових немає'
              }
              badge={requests.length}
            />
            <ManageTile
              href="/schedule/electives"
              icon="star"
              title="Вибіркові"
              hint={
                electives.data?.length
                  ? `${electives.data.length} ${pluralUk(electives.data.length, ['дисципліна', 'дисципліни', 'дисциплін'])}`
                  : 'Дисципліни за вибором'
              }
            />
            <ManageTile
              href="/settings/group"
              icon="sliders"
              title="Налаштування"
              hint={
                groupSettings.data
                  ? groupSettings.data.campusGroupId
                    ? groupSettings.data.scheduleSyncedAt
                      ? `Кампус синхр. ${timeAgo(groupSettings.data.scheduleSyncedAt)}`
                      : 'Кампус підключено'
                    : 'Кампус не підключено'
                  : 'Група, Кампус, учасники'
              }
            />
          </div>
          <div className="flex gap-2">
            <Link href="/homework/new" className="btn btn-secondary btn-md flex-1">
              <Icon name="plus" size={18} strokeWidth={2.2} />
              Завдання
            </Link>
            <Link href="/subjects/new" className="btn btn-secondary btn-md flex-1">
              <Icon name="plus" size={18} strokeWidth={2.2} />
              Дисципліна
            </Link>
          </div>
        </Section>
      ) : (
        <section aria-label="Швидкі дії" className="grid grid-cols-3 gap-2.5">
          <QuickTile
            href="/homework"
            icon="task"
            value={hwPending.isLoading ? '…' : hwFailed ? '—' : String(pendingCount)}
            label={pluralUk(pendingCount, ['завдання', 'завдання', 'завдань'])}
          />
          <QuickTile
            href={myQueue ? (`/subjects/${myQueue.subjectId}/queue` as Route) : '/subjects'}
            icon="list"
            value={queues.isLoading ? '…' : queuesFailed ? '—' : myQueue ? `№${myQueue.slot}` : String(openQueues)}
            label={
              myQueue
                ? `черга ${myQueue.name}`
                : pluralUk(openQueues, ['відкрита черга', 'відкриті черги', 'відкритих черг'])
            }
          />
          <QuickTile
            href="/schedule"
            icon="calendar"
            value={now.isLoading || lessonsQ.isLoading ? '…' : lessonsFailed ? '—' : String(todayLessons.length)}
            label={pluralUk(todayLessons.length, ['пара сьогодні', 'пари сьогодні', 'пар сьогодні'])}
          />
        </section>
      )}

      <Section
        title={canManage ? 'Пари сьогодні' : 'Сьогодні'}
        aside={
          <Link href={canManage ? '/attendance' : '/schedule'} className="font-semibold text-accent-text">
            {canManage ? 'Журнал за день' : 'Увесь тиждень'}
          </Link>
        }
      >
        {now.isLoading || lessonsQ.isLoading ? (
          <Loading />
        ) : lessonsFailed ? (
          <ErrorState
            error={now.isError ? now.error : lessonsQ.error}
            onRetry={() => (now.isError ? now.refetch() : lessonsQ.refetch())}
          />
        ) : todayLessons.length === 0 ? (
          <Empty icon="calendar" title="Сьогодні пар немає" hint="Розклад на тиждень — у вкладці «Розклад»." />
        ) : (
          <div className="card-flat flex flex-col px-3.5 py-1.5">
            {todayLessons.map((l, i) => {
              const state =
                nowMin >= toMin(l.endTime) ? 'past' : nowMin >= toMin(l.startTime) ? 'now' : 'next';
              const struck = state === 'past' && !canManage;
              const stats = lessonStats(l._id);
              const mark = ATT_CHIP[myMarkByLesson.get(l._id) ?? 'unknown'];
              let chip: ReactNode = null;
              if (canManage) {
                if (state === 'next') chip = <span className="chip">о {l.startTime}</span>;
                else if (stats)
                  chip = (
                    <span className="chip chip-ok">
                      {stats.present + stats.late}
                      {studentsCount ? ` / ${studentsCount}` : ''}
                    </span>
                  );
                else if (grid.data)
                  chip = (
                    <Link href={`/attendance/mark?lessonId=${l._id}` as Route} className="chip chip-warn chip-btn">
                      Відмітити
                    </Link>
                  );
              } else if (state === 'now') chip = <span className="chip chip-lime">зараз</span>;
              else if (state === 'past' && mark) chip = <span className={cn('chip', mark.cls)}>{mark.label}</span>;
              else if (l.meetingUrl) chip = <span className="chip chip-accent">Meet</span>;
              return (
                <Fragment key={l._id}>
                  {i > 0 ? <div className="divider" /> : null}
                  <div className={cn('row-plain', struck && 'opacity-[0.55]')}>
                    <span
                      className={cn(
                        'num w-12 flex-shrink-0 text-[13px]',
                        state === 'now' && 'text-accent-text',
                        canManage && state === 'past' && 'text-ink-3',
                      )}
                    >
                      {l.startTime}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className={cn('h3 truncate', struck && 'line-through decoration-ink-3')}>
                        {l.subjectName}
                      </span>
                      <span className="tiny faint truncate">
                        {joinParts([
                          l.type ? TYPE_LABEL[l.type] : null,
                          l.room || (l.meetingUrl ? 'онлайн' : null),
                        ])}
                      </span>
                    </div>
                    {chip}
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Найближчі дедлайни"
        aside={
          <Link href="/homework" className="font-semibold text-accent-text">
            Усі
          </Link>
        }
      >
        {hwPending.isLoading ? (
          <Loading />
        ) : hwFailed ? (
          <ErrorState error={hwPending.error} onRetry={() => hwPending.refetch()} />
        ) : deadlines.length === 0 ? (
          <Empty icon="task" title="Усе виконано" hint="Невиконаних завдань немає." />
        ) : (
          <div className="flex flex-col gap-2">
            {deadlines.map((h) => {
              const ticking = complete.isPending && complete.variables === h._id;
              return (
                <div key={h._id} className="row">
                  <button
                    type="button"
                    className="-m-2.5 flex flex-shrink-0 p-2.5"
                    aria-label="Позначити виконаним"
                    disabled={complete.isPending}
                    onClick={() => complete.mutate(h._id)}
                  >
                    <span className={cn('check', ticking && 'on')}>
                      {ticking ? <Icon name="check" size={14} strokeWidth={3} /> : null}
                    </span>
                  </button>
                  <Link
                    href={`/homework/${h._id}` as Route}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="h3">{h.title}</span>
                      <span className="tiny faint truncate">
                        {joinParts([
                          h.subjectName,
                          h.points ? `${h.points} ${pluralUk(h.points, ['бал', 'бали', 'балів'])}` : null,
                        ])}
                      </span>
                    </span>
                    <DeadlineChip deadline={h.deadline} />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        {complete.isError ? <div className="small text-bad">{complete.error.message}</div> : null}
      </Section>
    </div>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

/** Greeting header: date + week parity under the title, profile pill on the right. */
function HomeHeader({
  title,
  weekType,
  label,
  accentLabel,
}: {
  title: string;
  weekType?: 1 | 2;
  label: string;
  accentLabel?: boolean;
}) {
  const me = useMe();
  const name =
    me.data?.fullName || [me.data?.firstName, me.data?.lastName].filter(Boolean).join(' ');
  const date = dayjs().locale('uk').format('dd, D MMMM');
  return (
    <PageHeader
      title={title}
      subtitle={`${date.charAt(0).toUpperCase()}${date.slice(1)}${weekType ? ` · ${weekType === 1 ? 'I' : 'II'} тиждень` : ''}`}
      action={
        <Link
          href="/profile"
          aria-label="Профіль"
          className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1"
        >
          {label ? (
            <span className={cn('small font-semibold', accentLabel ? 'text-accent-text' : 'text-ink-2')}>
              {label}
            </span>
          ) : null}
          <UserAvatar name={name} src={myAvatarUrl(me.data)} className="tile-accent h-9 w-9 text-[12px]" />
        </Link>
      }
    />
  );
}

/** The signal card for the lesson that is on right now. */
function NowCard({
  lesson,
  nowMin,
  meta,
  actions,
}: {
  lesson: Lesson;
  nowMin: number;
  meta: string;
  actions: ReactNode;
}) {
  const start = toMin(lesson.startTime);
  const end = toMin(lesson.endTime);
  const left = Math.max(0, end - nowMin);
  const pct = Math.min(100, Math.max(0, ((nowMin - start) / Math.max(1, end - start)) * 100));
  return (
    <section className="now flex flex-col gap-3.5" aria-label="Зараз триває">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="num now-accent min-w-0 text-[26px] leading-none">
            {lesson.startTime}–{lesson.endTime}
          </div>
          <span className="chip flex-shrink-0 gap-1.5 bg-now-accent text-now-accent-ink">
            <span className="dot bg-current" />
            триває ще {left} хв
          </span>
        </div>
        <div className="text-[20px] font-bold leading-tight tracking-[-0.01em]">{lesson.subjectName}</div>
        {meta ? <div className="small now-muted">{meta}</div> : null}
      </div>
      <div className="bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-2 empty:hidden">{actions}</div>
    </section>
  );
}

/** «Далі: …» row; `parts` is the meta line, «через N хв» is appended. */
function NextRow({
  lesson,
  nowMin,
  title,
  parts,
}: {
  lesson: Lesson;
  nowMin: number;
  title: string;
  parts: Array<string | null | undefined>;
}) {
  const inMin = toMin(lesson.startTime) - nowMin;
  return (
    <Link href="/schedule" className="row justify-between">
      <span className="flex min-w-0 items-center gap-3">
        <span className="num text-[14px] text-accent-text">{lesson.startTime}</span>
        <span className="flex min-w-0 flex-col">
          <span className="h3 truncate">Далі: {title}</span>
          <span className="tiny faint truncate">
            {joinParts([
              ...parts,
              inMin > 0 ? `через ${inMin < 60 ? `${inMin} хв` : `${Math.floor(inMin / 60)} год${inMin % 60 ? ` ${inMin % 60} хв` : ''}`}` : null,
            ])}
          </span>
        </span>
      </span>
      <Icon name="chevronRight" className="chev" />
    </Link>
  );
}

function QuickTile({
  href,
  icon,
  value,
  label,
}: {
  href: Route;
  icon: IconName;
  value: string;
  label: string;
}) {
  return (
    <Link href={href} className="card-flat flex flex-col gap-2.5 p-3.5">
      <span className="tile tile-soft h-9 w-9 rounded-[12px]">
        <Icon name={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="num text-[20px] leading-none">{value}</span>
        <span className="tiny muted truncate">{label}</span>
      </span>
    </Link>
  );
}

function ManageTile({
  href,
  icon,
  title,
  hint,
  badge,
}: {
  href: Route;
  icon: IconName;
  title: string;
  hint: string;
  badge?: number;
}) {
  return (
    <Link href={href} className="card-flat flex flex-col gap-3 p-3.5">
      <span className="flex items-center justify-between">
        <span className="tile tile-soft h-9 w-9 rounded-[12px]">
          <Icon name={icon} size={18} />
        </span>
        {badge ? <span className="count">{badge}</span> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="h3">{title}</span>
        <span className="tiny faint">{hint}</span>
      </span>
    </Link>
  );
}

function DeadlineChip({ deadline }: { deadline?: string }) {
  if (!deadline) return null;
  const d = dayjs(deadline).locale('uk');
  if (d.isBefore(dayjs())) return <span className="chip chip-bad flex-shrink-0">прострочено</span>;
  const days = d.startOf('day').diff(dayjs().startOf('day'), 'day');
  if (days === 0) return <span className="chip chip-warn flex-shrink-0">сьогодні</span>;
  if (days === 1) return <span className="chip chip-warn flex-shrink-0">завтра</span>;
  return <span className="chip flex-shrink-0">{d.format('dd, D MMM')}.</span>;
}

/**
 * now/next only change at lesson boundaries, so instead of polling refetch when the
 * current lesson ends (or the next one starts). The second shot a minute later
 * covers a server clock lagging the phone's. Hidden app → resume refetch covers it.
 */
function useRefetchAtBoundary(
  data: NowResponse | undefined,
  nowMin: number,
  refetch: (o: { cancelRefetch: boolean }) => unknown,
) {
  const at = data?.current?.endTime ?? data?.next?.startTime;
  const late = at ? nowMin - toMin(at) : -1;
  const key = late >= 0 ? `${at}#${Math.min(late, 1)}` : '';
  const fired = useRef('');
  useEffect(() => {
    if (!key || fired.current === key || !focusManager.isFocused()) return;
    fired.current = key;
    void refetch({ cancelRefetch: false }); // join a fetch already in flight
  }, [key, refetch]);
}

/** Minutes since midnight, refreshed every 30 s so "триває ще N хв" and the bar keep moving. */
function useNowMinutes(): number {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now.getHours() * 60 + now.getMinutes();
}

/** Entries still waiting for their turn (passed / missed / failed are done). */
const WAITING = new Set(['default', 'preparing', 'passing']);
const isWaiting = (e: { status?: string }) => WAITING.has(e.status ?? 'default');

/**
 * My spot in a queue: `slot` is the number the queue screen shows, `place` my real turn —
 * only slots above me that still wait count, so it moves up as people hand in their labs.
 */
function queueSpot(q: RawQueue, userId: string): { slot: number; place: number } | null {
  const entries = (q.entries ?? []).filter(isWaiting);
  const mine = entries.filter((e) => String(e.userId) === userId).map((e) => e.slotIndex);
  if (!mine.length) return null;
  const slot = Math.min(...mine);
  const ahead = new Set(entries.filter((e) => e.slotIndex < slot).map((e) => e.slotIndex));
  return { slot, place: ahead.size + 1 };
}

function waitingCount(q: RawQueue): number {
  return (q.entries ?? []).filter(isWaiting).length;
}

/** Teacher row meta: «черга відкрита» / «черга відкриється ср» / «черга закрита» (count lives on the now card). */
function queueLine(q: RawQueue | undefined): string | null {
  if (!q) return null;
  if (isQueueOpen(q)) return 'черга відкрита';
  const at = q.rules?.autoOpenAt ? dayjs(q.rules.autoOpenAt) : null;
  if (at?.isAfter(dayjs()))
    return `черга відкриється ${at.locale('uk').format(at.diff(dayjs(), 'day') < 6 ? 'dd' : 'D MMM.')}`;
  return 'черга закрита';
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

function pluralUk(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
