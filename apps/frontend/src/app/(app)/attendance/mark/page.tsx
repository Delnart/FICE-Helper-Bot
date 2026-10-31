'use client';

import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../components/Empty';
import { Icon } from '../../../../components/icons';
import { Sheet } from '../../../../components/ui/Sheet';
import { haptic } from '../../../../lib/telegram';
import { cn } from '../../../../lib/cn';
import { subjectAcronym } from '../../../../lib/name';
import { runsOn } from '../../../../lib/lessons';
import { useActiveMembership } from '../../../../hooks/useMe';

type Status = 'present' | 'absent' | 'late' | 'excused' | 'unknown';

interface GroupLesson {
  _id: string;
  subjectId?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  room?: string;
  type?: string;
  weekType: 0 | 1 | 2;
  dates?: string[];
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

/** The slice of GET /attendance/week-grid this page uses (Home caches it under the same key). */
interface WeekGrid {
  lessons: Array<{ _id: string; subjectShortName?: string }>;
  students: Array<{ _id: string; fullName: string; username?: string; isManual?: boolean }>;
  marks: Array<{ lessonId: string; status: Status }>;
}

/** The slice of GET /queues used here (same cache as Home / Дисципліни). */
interface QueueLite {
  subjectId: string;
  entries?: Array<{ userId: string; status?: string; labNumber?: number }>;
}

/** Unsaved marks + notes of one lesson-day. */
interface Draft {
  statuses: Record<string, Status>;
  notes?: Record<string, string>;
}

const STATUSES: Array<{ k: Status; label: string; st: string; dot: string; legend: string }> = [
  { k: 'present', label: 'П', st: 'on-ok', dot: 'bg-ok', legend: 'присутній' },
  { k: 'absent', label: 'Н', st: 'on-bad', dot: 'bg-bad', legend: 'відсутній' },
  { k: 'late', label: 'Зап', st: 'on-warn', dot: 'bg-warn', legend: 'запізнився' },
  { k: 'excused', label: 'Пов', st: 'on-info', dot: 'bg-info', legend: 'поважна' },
];

const LESSON_TYPE: Record<string, string> = { lecture: 'лек', practice: 'прак', lab: 'лаб', seminar: 'сем' };

function dayOfWeekFromIso(iso: string): number {
  // Mon=1..Sun=7 → KPI: 1..6 (Sun excluded)
  const dow = ((dayjs(iso).day() + 6) % 7) + 1;
  return dow;
}

function mondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  return d.subtract((d.day() + 6) % 7, 'day').startOf('day');
}

/** Unsaved marks survive closing the app: localStorage per group + lesson + date. */
function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, value: Draft | null) {
  try {
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode / storage blocked — the draft is a convenience */
  }
}

export default function MarkAttendancePage() {
  const qc = useQueryClient();
  const membership = useActiveMembership();
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  // Per-student note saved with the mark (entries[].note), e.g. "довідка до 30 жовт."
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<{ id: string; name: string } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
  const [bulkSheet, setBulkSheet] = useState(false);
  const [search, setSearch] = useState('');
  const todayIso = dayjs().format('YYYY-MM-DD');

  // Determine current week parity from /schedule/now (which exposes weekType)
  const nowQ = useQuery({
    queryKey: ['schedule-now'],
    queryFn: () => api<{ weekType: 1 | 2 }>('/schedule/now'),
  });
  // Parity of the chosen date's week: weeks alternate, so count them from this week.
  const weekIso = mondayOf(dayjs(date)).format('YYYY-MM-DD');
  const weeksAway = Math.round(dayjs(weekIso).diff(mondayOf(dayjs()), 'week', true));
  const nowWeek = nowQ.data?.weekType ?? 1;
  const week = weeksAway % 2 === 0 ? nowWeek : nowWeek === 1 ? 2 : 1;

  // Lessons of the active group for the date's parity
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

  // The date's journal week: which lessons already have marks (✓), short names, manual students.
  const gridQ = useQuery({
    queryKey: ['attendance-grid', weekIso, null],
    queryFn: () => api<WeekGrid>('/attendance/week-grid', { query: { weekStart: weekIso } }),
  });

  // Lab queues: who is submitting right now ("зараз здає лабу").
  const queuesQ = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<QueueLite[]>('/queues'),
  });

  // Currently saved record for the chosen lesson + date
  const savedQ = useQuery({
    queryKey: ['attendance-lesson', selectedLesson, date],
    queryFn: () =>
      api<SavedRecord>('/attendance/lesson', { query: { lessonId: selectedLesson!, date } }),
    enabled: !!selectedLesson,
  });

  const markedLessons = useMemo(
    () => new Set((gridQ.data?.marks ?? []).filter((m) => m.status !== 'unknown').map((m) => m.lessonId)),
    [gridQ.data],
  );
  const shortNames = new Map((gridQ.data?.lessons ?? []).map((l) => [l._id, l.subjectShortName]));

  // A lesson not running on this date stays while it has marks that week, so they remain reachable.
  const dayLessons = useMemo(() => {
    const dow = dayOfWeekFromIso(date);
    return (lessonsQ.data ?? [])
      .filter((l) => l.dayOfWeek === dow && (runsOn(l, date) || markedLessons.has(l._id)))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [lessonsQ.data, date, markedLessons]);

  // Today: preselect the lesson in progress (else the last one that started), once per date —
  // Home's "Відмітити присутніх" lands here without params. Home's per-lesson «Відмітити» chip
  // passes ?lessonId= of a today's lesson: that one wins; an id not on today's schedule is ignored.
  // Only lessons that run today count: one kept for its marks is never preselected.
  const askedLesson = useSearchParams()?.get('lessonId');
  const [autoPickedFor, setAutoPickedFor] = useState<string | null>(null);
  useEffect(() => {
    // nowQ too: before it loads, `week` defaults to 1 and a cached week-1 list is the wrong parity.
    if (autoPickedFor === date || selectedLesson || !nowQ.data || !lessonsQ.data) return;
    setAutoPickedFor(date);
    if (date !== todayIso) return;
    const hm = dayjs().format('HH:mm');
    const running = dayLessons.filter((l) => runsOn(l, date));
    const started = running.filter((l) => l.startTime <= hm);
    const pick =
      running.find((l) => l._id === askedLesson) ??
      started.find((l) => hm < l.endTime) ??
      started[started.length - 1];
    if (pick) setSelectedLesson(pick._id);
  }, [autoPickedFor, date, todayIso, selectedLesson, nowQ.data, lessonsQ.data, dayLessons, askedLesson]);

  // Hydrate statuses from the saved record once per lesson+date (default unknown), then
  // lay an unsaved draft over it. Not on every savedQ/membersQ change: a background refetch
  // (window focus, post-save invalidation) would otherwise wipe unsaved marks.
  const lessonKey = selectedLesson ? `${selectedLesson}::${date}` : null;
  const draftKey = lessonKey ? `fice:mark-draft:${membership?.groupId ?? ''}:${lessonKey}` : null;
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const ready = !!lessonKey && hydratedFor === lessonKey;
  useEffect(() => {
    if (!lessonKey || !draftKey || hydratedFor === lessonKey) return;
    // Wait for a fresh copy: a cached record may be mid-refetch. The grid only adds manual students.
    if (!savedQ.data || savedQ.isFetching || !membersQ.data || gridQ.isLoading) return;
    const initial: Record<string, Status> = {};
    const savedNotes: Record<string, string> = {};
    for (const m of membersQ.data) initial[m._id] = 'unknown';
    for (const s of gridQ.data?.students ?? []) if (s.isManual) initial[s._id] = 'unknown';
    for (const e of savedQ.data.entries ?? []) {
      initial[e.userId] = e.status;
      if (e.note) savedNotes[e.userId] = e.note;
    }
    const draft = readDraft(draftKey);
    // Only ids the page knows; a stale id would make the save fail with 400.
    for (const [id, s] of Object.entries(draft?.statuses ?? {})) if (id in initial) initial[id] = s;
    setStatuses(initial);
    // The draft holds the whole notes map, so a note removed in it stays removed.
    setNotes(draft?.notes ?? savedNotes);
    setDirty(!!draft);
    setHydratedFor(lessonKey);
  }, [lessonKey, draftKey, hydratedFor, savedQ.data, savedQ.isFetching, membersQ.data, gridQ.isLoading, gridQ.data]);

  useEffect(() => {
    if (ready && dirty && draftKey) writeDraft(draftKey, { statuses, notes });
  }, [ready, dirty, draftKey, statuses, notes]);

  const save = useMutation({
    mutationFn: (_draftKey: string) =>
      api('/attendance', {
        method: 'POST',
        json: {
          scheduleLessonId: selectedLesson,
          // The plain day: a local-midnight timestamp is the previous day in UTC, where the server keys records.
          date,
          entries: Object.entries(statuses)
            .filter(([, s]) => s && s !== 'unknown')
            .map(([userId, status]) => ({ userId, status, note: notes[userId] || undefined })),
        },
      }),
    onSuccess: (_res, savedDraftKey) => {
      haptic('success');
      writeDraft(savedDraftKey, null);
      if (savedDraftKey === draftKey) setDirty(false);
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['attendance-stats'] });
      qc.invalidateQueries({ queryKey: ['attendance-grid'] });
      qc.invalidateQueries({ queryKey: ['attendance-period'] });
      qc.invalidateQueries({ queryKey: ['attendance-lesson', selectedLesson, date] });
    },
    onError: () => {
      haptic('error');
      qc.invalidateQueries({ queryKey: ['attendance-grid'] });
    },
  });

  // Placeholder students the head added by hand (no Telegram account) are marked here too.
  // Alphabetical like the journal, so manual students don't trail at the end.
  const members: Array<{ _id: string; fullName: string; username?: string }> = [
    ...(membersQ.data ?? []),
    ...(gridQ.data?.students ?? []).filter((s) => s.isManual),
  ].sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk'));

  // Live queue state only means something for today's lesson.
  const lesson = dayLessons.find((l) => l._id === selectedLesson);
  const passingLab = new Map<string, number | undefined>();
  if (lesson?.subjectId && date === todayIso) {
    for (const q of queuesQ.data ?? []) {
      if (String(q.subjectId) !== lesson.subjectId) continue;
      for (const e of q.entries ?? []) if (e.status === 'passing') passingLab.set(String(e.userId), e.labNumber);
    }
  }

  function touch() {
    setDirty(true);
    if (save.isSuccess || save.isError) save.reset();
  }

  function edit(update: (prev: Record<string, Status>) => Record<string, Status>) {
    setStatuses(update);
    touch();
  }

  function applyNote() {
    if (!noteFor) return;
    const id = noteFor.id;
    const text = noteText.trim();
    if (text !== (notes[id] ?? '')) {
      setNotes((prev) => {
        const next = { ...prev };
        if (text) next[id] = text;
        else delete next[id];
        return next;
      });
      touch();
    }
    setNoteFor(null);
  }

  function setAll(s: Status) {
    edit(() => {
      const next: Record<string, Status> = {};
      for (const m of members) next[m._id] = s;
      return next;
    });
  }

  function setRestPresent() {
    edit((prev) => {
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
  const restButton = (
    <button type="button" className="btn btn-secondary btn-sm flex-shrink-0" onClick={setRestPresent}>
      Решту — П
    </button>
  );

  const q = search.trim().toLowerCase();
  const visibleMembers = q
    ? members.filter((m) => m.fullName.toLowerCase().includes(q) || m.username?.toLowerCase().includes(q))
    : members;

  const dateLabel = dayjs(date).locale('uk').format('dd, D MMMM');
  const subtitle = [dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1), membership?.groupName]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-3.5">
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
            const done = markedLessons.has(l._id);
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
                title={[l.subjectName, type].filter(Boolean).join(' · ')}
              >
                <span className="num text-xs">{l.startTime}</span>
                {/* Short label like the journal columns; the lesson type only on the picked chip (mockup). */}
                <span className="min-w-0 truncate">
                  {shortNames.get(l._id) || subjectAcronym(l.subjectName)}
                  {on && type ? ` · ${type}` : ''}
                </span>
                {done ? (
                  <span className="chip chip-ok h-[18px] px-1.5" aria-label="відмічено">
                    <Icon name="check" size={11} strokeWidth={3} />
                  </span>
                ) : null}
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
            {/* Counters + "Решту — П" on one row, like the mockup; "Усім одразу" sits by the search.
                A 5th counter (поважні) leaves no room for the button, so it then moves beside the bar. */}
            <div className="flex items-center justify-between gap-2">
              <div className={cn('flex gap-3.5', counts.excused > 0 && 'flex-1 justify-between')}>
                <Counter value={counts.present} label="присутні" className="text-ok" />
                <Counter value={counts.absent} label="відсутні" className="text-bad" />
                <Counter value={counts.late} label="запізн." className="text-warn" />
                {counts.excused ? <Counter value={counts.excused} label="поважні" className="text-info" /> : null}
                <Counter value={counts.unknown} label="не відм." />
              </div>
              {counts.excused ? null : restButton}
            </div>
            <div className="flex items-center gap-3">
              <div className="bar bar-accent flex-1" aria-hidden="true">
                <span style={{ width: `${members.length ? (marked / members.length) * 100 : 0}%` }} />
              </div>
              {counts.excused ? restButton : null}
            </div>
          </section>

          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
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
            <button
              type="button"
              className="icon-btn"
              onClick={() => setBulkSheet(true)}
              aria-label="Усім одразу"
              title="Усім одразу"
            >
              <Icon name="more" />
            </button>
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
              {visibleMembers.map((m, i) => {
                const note = notes[m._id];
                const lab = passingLab.has(m._id) ? passingLab.get(m._id) : null;
                return (
                  <div key={m._id}>
                    {i > 0 ? <div className="divider" /> : null}
                    <div className="row-plain justify-between gap-2">
                      {/* Tap the name to add a note (reason of absence etc.), saved with the mark. */}
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 flex-col items-start text-left"
                        aria-haspopup="dialog"
                        title="Примітка"
                        onClick={() => {
                          setNoteFor({ id: m._id, name: m.fullName });
                          setNoteText(note ?? '');
                        }}
                      >
                        <span className="h3 max-w-full truncate">{m.fullName}</span>
                        {note ? (
                          <span className="tiny faint max-w-full truncate">{note}</span>
                        ) : lab !== null ? (
                          <span className="tiny faint">зараз здає лабу{lab ? ` ${lab}` : ''}</span>
                        ) : statuses[m._id] === 'excused' ? (
                          <span className="tiny font-semibold text-accent-text">+ причина</span>
                        ) : m.username ? (
                          <span className="tiny faint max-w-full truncate">@{m.username}</span>
                        ) : null}
                      </button>
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
                                edit((prev) => ({
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
                );
              })}
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

      <Sheet open={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor?.name ?? 'Примітка'}>
        <div className="small muted -mt-2">Примітка до відмітки, напр. «довідка до 30 жовт.»</div>
        <input
          className="input"
          aria-label="Примітка"
          placeholder="Причина або коментар"
          maxLength={300}
          autoFocus
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyNote()}
        />
        {noteFor && (statuses[noteFor.id] ?? 'unknown') === 'unknown' ? (
          <div className="hint">Збережеться разом з відміткою студента.</div>
        ) : null}
        <button type="button" className="btn btn-primary btn-block" onClick={applyNote}>
          Готово
        </button>
      </Sheet>

      <Sheet open={bulkSheet} onClose={() => setBulkSheet(false)} title="Усім одразу">
        <div className="small muted -mt-2">Замінить відмітки всіх студентів цієї пари.</div>
        <div className="flex flex-col">
          {[...STATUSES, { k: 'unknown' as Status, label: '·', st: '', legend: 'скинути відмітки' }].map((s) => (
            <button
              key={s.k}
              type="button"
              className="row w-full text-left"
              onClick={() => {
                setAll(s.k);
                setBulkSheet(false);
              }}
            >
              <span className={cn('st pointer-events-none', s.st)}>{s.label}</span>
              <span className="flex-1 font-semibold">Усім — {s.legend}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {selectedLesson ? (
        <div className="action-bar flex-col">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={save.isPending || !ready}
            onClick={() => draftKey && save.mutate(draftKey)}
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
            <span className="tiny faint text-center">
              Чернетка зберігається автоматично. Невідмічені залишаться порожніми.
            </span>
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
