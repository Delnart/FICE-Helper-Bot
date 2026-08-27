'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, setActiveGroup } from '../../lib/api';
import { PageHeader } from '../../components/PageHeader';
import { Empty } from '../../components/Empty';
import { cn } from '../../lib/cn';
import { useCanManage, useIsTeacherOnly, useMe } from '../../hooks/useMe';
import { haptic } from '../../lib/telegram';

interface MySubject {
  _id: string;
  name: string;
  shortName?: string;
  groupId: string;
  groupName: string;
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
  teachers: Array<{ fullName: string }>;
}

interface NowCard {
  subjectName: string;
  startTime: string;
  endTime: string;
  room?: string;
  meetingUrl?: string;
  groupName?: string;
}

export default function HomePage() {
  const isTeacherOnly = useIsTeacherOnly();
  if (isTeacherOnly) return <TeacherHomePage />;
  return <StudentHomePage />;
}

function TeacherHomePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useMe();

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

  const openSubject = (s: MySubject) => {
    haptic('selection');
    setActiveGroup(s.groupId);
    router.push(`/subjects/${s._id}`);
  };

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

  // ── Identification screen ──────────────────────────────────────────────────
  if (!me.data?.campusLecturerId) {
    const prefilledFromSheet = !!me.data?.fullName;
    // While auto-identify is in flight (and hasn't returned candidates), show
    // a clean loader instead of the "fill ПІБ" form.
    if (
      prefilledFromSheet &&
      identify.isPending &&
      candidates.length === 0
    ) {
      return (
        <div className="space-y-5">
          <PageHeader title="Мої предмети" />
          <div className="card flex items-center justify-center py-10">
            <div className="flex flex-col items-center gap-3 text-ink-500">
              <div className="h-8 w-8 rounded-full border-2 border-paper-300 border-t-ink-900 animate-spin" />
              <div className="text-sm">Підключення до Кампус КПІ…</div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-5">
        <PageHeader title="Мої предмети" />

        <div className="card space-y-4">
          <div>
            <div className="font-semibold text-[16px]">Підключення до Кампус КПІ</div>
            <div className="text-sm text-ink-500 mt-1 leading-relaxed">
              {prefilledFromSheet
                ? 'Ваше ПІБ автоматично взято з таблиці викладачів. Натисніть «Знайти предмети» — система знайде ваші курси у Кампус КПІ.'
                : 'Вкажіть ваше ПІБ у форматі «Прізвище Ім\'я По-батькові» — система автоматично знайде ваші предмети в розкладі.'}
            </div>
          </div>

          <div>
            <div className="label">ПІБ</div>
            <input
              className="input"
              value={identifyName}
              onChange={(e) => setIdentifyName(e.target.value)}
              placeholder="Прізвище Ім'я По-батькові"
            />
          </div>

          {identifyError ? (
            <div className="text-sm text-red-500 leading-snug">{identifyError}</div>
          ) : null}

          <button
            type="button"
            className="btn-primary w-full"
            disabled={identify.isPending || !identifyName.trim()}
            onClick={() => {
              setCandidates([]);
              setIdentifyError('');
              identify.mutate({ name: identifyName.trim() });
            }}
          >
            {identify.isPending && !candidates.length ? 'Пошук…' : 'Знайти предмети'}
          </button>
        </div>

        {candidates.length > 0 ? (
          <section>
            <div className="section-title">Оберіть ваш профіль</div>
            <div className="space-y-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="card w-full text-left flex items-center justify-between gap-3 hover:bg-paper-100 active:scale-[0.99] transition-transform"
                  disabled={identify.isPending}
                  onClick={() => {
                    setCandidates([]);
                    setIdentifyError('');
                    identify.mutate({ lecturerId: c.id });
                  }}
                >
                  <span className="font-medium text-sm">{c.name}</span>
                  <span className="chip flex-shrink-0">Це я</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  // ── Subjects screen ────────────────────────────────────────────────────────
  const subjects = mySubjects.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Мої предмети" />

      <TeacherNowCard />

      {mySubjects.isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : subjects.length === 0 ? (
        <div className="card space-y-2">
          <div className="font-medium">Предмети не знайдено</div>
          <div className="text-sm text-ink-500 leading-relaxed">
            Старости груп ще не створили предмети або ще не додали вас до них. Як тільки вони
            це зроблять — предмети з'являться тут автоматично.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {subjects.map((s) => (
            <button
              key={s._id}
              type="button"
              className="card w-full text-left flex items-center gap-3 hover:bg-paper-100 active:scale-[0.99] transition-transform"
              onClick={() => openSubject(s)}
            >
              <SubjectIcon name={s.shortName ?? s.name} id={s._id} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[15px] truncate">{s.shortName ?? s.name}</div>
                {s.shortName && s.name !== s.shortName ? (
                  <div className="text-[11px] text-ink-500 truncate">{s.name}</div>
                ) : null}
                <div className="text-xs text-ink-500 mt-0.5">{s.groupName}</div>
              </div>
              <span className="text-ink-300 flex-shrink-0 text-lg">›</span>
            </button>
          ))}
        </div>
      )}

      {/* Self-service: request read-only access to another group's queue */}
      <TeacherJoinSection />
    </div>
  );
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
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-sm">Доступ до іншої групи</div>
          <div className="text-xs text-ink-500 mt-0.5 leading-relaxed">
            Надішліть запит старості — він підтвердить, і ви отримаєте перегляд черг.
          </div>
        </div>
        {!open && !picked ? (
          <button
            type="button"
            className="btn-primary h-8 px-3 text-xs whitespace-nowrap"
            onClick={() => setOpen(true)}
          >
            + Додати
          </button>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <div className="space-y-1.5">
          {pending.map((r) => (
            <div
              key={r._id}
              className="flex items-center justify-between rounded-xl bg-paper-100 px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium">{r.groupName}</span>
                <span className="text-ink-500 ml-2">очікує підтвердження</span>
              </div>
              <div className="h-2 w-2 rounded-full bg-warning animate-pulse" />
            </div>
          ))}
        </div>
      ) : null}

      {open && !picked ? (
        <div className="space-y-2">
          <input
            className="input w-full"
            placeholder="Пошук групи (ІП-41, УВ-з51ф…)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {groups.isLoading ? (
            <div className="text-xs text-ink-500 px-1">Завантаження…</div>
          ) : (groups.data ?? []).length === 0 ? (
            <div className="text-xs text-ink-500 px-1">Групи не знайдено</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(groups.data ?? []).map((g) => (
                <button
                  key={g._id}
                  type="button"
                  className="w-full text-left rounded-xl bg-paper-100 hover:bg-paper-200 px-3 py-2.5 text-sm font-medium"
                  onClick={() => setPicked(g)}
                >
                  {g.academicName}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="text-xs text-ink-400 hover:text-ink-700"
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
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-accent-soft text-accent px-3 py-2.5">
            <div>
              <div className="font-medium text-sm">{picked.academicName}</div>
              <div className="text-xs opacity-80">Обрана група</div>
            </div>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setPicked(null)}
            >
              Змінити
            </button>
          </div>
          <textarea
            className="input w-full h-20 resize-none text-sm"
            placeholder="Коротко: який саме предмет / навіщо доступ (необов'язково)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error ? <div className="text-sm text-danger">{error}</div> : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={submit.isPending}
              onClick={() => submit.mutate(picked._id)}
            >
              {submit.isPending ? 'Надсилаємо…' : 'Надіслати запит'}
            </button>
            <button
              type="button"
              className="btn-secondary px-4"
              onClick={() => {
                setOpen(false);
                setPicked(null);
                setError(null);
              }}
            >
              Скасувати
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Teacher's "now / next lesson" widget — same vibe as the student home card,
 * fed by /schedule/lecturer/now (live from Campus). No room/teacher info if
 * Campus didn't return it; we just hide the row.
 */
function TeacherNowCard() {
  const now = useQuery({
    queryKey: ['lecturer-now'],
    queryFn: () =>
      api<{ current: NowCard | null; next: NowCard | null }>('/schedule/lecturer/now'),
    refetchInterval: 60_000,
    retry: 0,
  });

  if (now.data?.current) {
    return (
      <section className="card bg-ink-900 text-paper-50 border-ink-900">
        <div className="text-[12px] uppercase tracking-wide text-paper-300/80">Зараз триває</div>
        <div className="font-semibold text-[17px] mt-1">{now.data.current.subjectName}</div>
        {now.data.current.groupName ? (
          <div className="text-sm text-paper-300/80 mt-0.5">{now.data.current.groupName}</div>
        ) : null}
        <div className="text-sm text-paper-300 mt-1">
          {now.data.current.startTime} – {now.data.current.endTime}
          {now.data.current.room ? ` · ${now.data.current.room}` : ''}
        </div>
        {now.data.current.meetingUrl ? (
          <a
            href={now.data.current.meetingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-accent-soft text-sm underline"
          >
            Перейти до зустрічі
          </a>
        ) : null}
      </section>
    );
  }
  if (now.data?.next) {
    return (
      <section className="card">
        <div className="text-[12px] uppercase tracking-wide text-ink-500">Наступна пара</div>
        <div className="font-semibold text-[17px] mt-1">{now.data.next.subjectName}</div>
        {now.data.next.groupName ? (
          <div className="text-sm text-ink-500 mt-0.5">{now.data.next.groupName}</div>
        ) : null}
        <div className="text-sm text-ink-500 mt-1">
          {now.data.next.startTime} – {now.data.next.endTime}
          {now.data.next.room ? ` · ${now.data.next.room}` : ''}
        </div>
      </section>
    );
  }
  return null;
}

function SubjectIcon({ name, id }: { name: string; id: string }) {
  const initials = makeInitials(name);
  const tone = toneFor(id);
  return (
    <div
      className={cn(
        'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold',
        tone,
      )}
    >
      {initials}
    </div>
  );
}

function StudentHomePage() {
  const canManage = useCanManage();
  const hwPending = useQuery({
    queryKey: ['hw-pending-count'],
    queryFn: () => api<Array<{ _id: string }>>('/homework/my/pending'),
    staleTime: 30_000,
  });
  const now = useQuery({
    queryKey: ['schedule-now'],
    queryFn: () => api<{ current: NowCard | null; next: NowCard | null }>('/schedule/now'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectSummary[]>('/subjects'),
    staleTime: 30_000,
  });

  const pendingCount = hwPending.data?.length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Головна"
        action={
          canManage ? (
            <Link href="/subjects/new" className="btn-primary h-9 px-3 text-sm">
              + Предмет
            </Link>
          ) : undefined
        }
      />

      {/* Pending HW button */}
      <Link
        href="/homework"
        className="card flex items-center justify-between hover:bg-paper-100"
      >
        <div>
          <div className="font-medium">Невиконані домашні завдання</div>
          <div className="text-sm text-ink-500 mt-0.5">
            {hwPending.isLoading
              ? 'Завантаження…'
              : pendingCount > 0
                ? `${pendingCount} ${pluralUk(pendingCount, ['активне', 'активні', 'активних'])}`
                : 'Усе виконано'}
          </div>
        </div>
        <span
          className={
            pendingCount > 0
              ? 'chip bg-ink-900 text-paper-50 min-w-7 justify-center'
              : 'chip'
          }
        >
          {pendingCount > 0 ? pendingCount : 'Відкрити'}
        </span>
      </Link>

      {/* Now / Next lesson */}
      {now.data?.current ? (
        <section className="card bg-ink-900 text-paper-50 border-ink-900">
          <div className="text-[12px] uppercase tracking-wide text-paper-300/80">Зараз триває</div>
          <div className="font-semibold text-[17px] mt-1">{now.data.current.subjectName}</div>
          <div className="text-sm text-paper-300 mt-1">
            {now.data.current.startTime} – {now.data.current.endTime}
            {now.data.current.room ? ` · ${now.data.current.room}` : ''}
          </div>
          {now.data.current.meetingUrl ? (
            <a
              href={now.data.current.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-accent-soft text-sm underline"
            >
              Перейти до зустрічі
            </a>
          ) : null}
        </section>
      ) : now.data?.next ? (
        <section className="card">
          <div className="text-[12px] uppercase tracking-wide text-ink-500">Наступна пара</div>
          <div className="font-semibold text-[17px] mt-1">{now.data.next.subjectName}</div>
          <div className="text-sm text-ink-500 mt-1">
            {now.data.next.startTime} – {now.data.next.endTime}
            {now.data.next.room ? ` · ${now.data.next.room}` : ''}
          </div>
        </section>
      ) : null}

      {/* Subjects fill the rest */}
      <section>
        <div className="section-title">Предмети</div>
        {subjects.isLoading ? (
          <div className="card text-ink-500 text-sm">Завантаження…</div>
        ) : subjects.data && subjects.data.length ? (
          <div className="grid grid-cols-2 gap-2.5">
            {subjects.data.map((s) => (
              <SubjectCard key={s._id} subject={s} />
            ))}
          </div>
        ) : (
          <Empty
            title="Поки немає предметів"
            hint={
              canManage
                ? 'Натисніть «+ Предмет» вгорі, щоб додати'
                : 'Староста ще не додала жодного предмета'
            }
          />
        )}
      </section>
    </div>
  );
}

function SubjectCard({ subject }: { subject: SubjectSummary }) {
  const display = subject.shortName ?? subject.name;
  const initials = makeInitials(display);
  const tone = toneFor(subject._id);
  const teacherCount = subject.teachers.length;
  const firstTeacher = subject.teachers[0]?.fullName;

  return (
    <Link
      href={`/subjects/${subject._id}`}
      className="card group h-full p-3.5 flex flex-col gap-3 hover:bg-paper-100 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold',
            tone,
          )}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] leading-tight line-clamp-2">{display}</div>
          {subject.shortName && subject.name !== subject.shortName ? (
            <div className="text-[11px] text-ink-500 mt-1 line-clamp-1">{subject.name}</div>
          ) : null}
        </div>
      </div>
      <div className="text-[12px] text-ink-500 mt-auto line-clamp-1">
        {teacherCount === 0
          ? 'Викладача не призначено'
          : teacherCount === 1
            ? firstTeacher
            : `${firstTeacher} +${teacherCount - 1}`}
      </div>
    </Link>
  );
}

/**
 * Two-tone deterministic palette: alternates between vibrant blue and dark slate,
 * keeping the home grid lively without going rainbow.
 */
const TONES: string[] = [
  'bg-accent text-paper-50',
  'bg-ink-900 text-paper-50',
  'bg-accent-soft text-accent',
];
function toneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

function makeInitials(s: string): string {
  const parts = s
    .replace(/["'«»]/g, '')
    .split(/[\s\-/]+/)
    .filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) {
    const p = parts[0].toUpperCase();
    return p.length <= 3 ? p : p.slice(0, 2);
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function pluralUk(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
