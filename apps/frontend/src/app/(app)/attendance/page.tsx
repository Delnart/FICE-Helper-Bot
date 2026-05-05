'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { haptic } from '../../../lib/telegram';
import { cn } from '../../../lib/cn';
import { shortenName } from '../../../lib/name';
import { useActiveMembership, useIsTeacherOnly } from '../../../hooks/useMe';

dayjs.locale('uk');

type Status = 'present' | 'absent' | 'excused' | 'late' | 'unknown';

interface WeekGrid {
  weekStart: string;
  weekType: 1 | 2;
  lessons: Array<{
    _id: string;
    subjectId?: string;
    subjectName: string;
    type: string;
    dayOfWeek: number;
    lessonNumber: number;
    startTime: string;
    endTime: string;
    date: string;
  }>;
  students: Array<{ _id: string; fullName: string; username?: string; isManual?: boolean }>;
  marks: Array<{ studentId: string; lessonId: string; date: string; status: Status }>;
  perStudentWeek: Record<string, { absent: number; excused: number; late: number }>;
  perStudentTotal: Record<string, { absent: number; excused: number; late: number }>;
  perLessonWeek: Record<string, { present: number; absent: number; excused: number; late: number }>;
}

interface GroupSettings {
  canEdit: boolean;
}

interface TeacherSubject {
  _id: string;
  name: string;
  shortName?: string;
  groupId: string;
  groupName: string;
}

const STATUS_CYCLE: Status[] = ['unknown', 'present', 'absent', 'excused', 'late'];
const STATUS_LABEL: Record<Status, string> = {
  present: 'П',
  absent: 'Н',
  excused: 'П/п',
  late: 'З',
  unknown: '·',
};
const STATUS_FULL: Record<Status, string> = {
  present: 'Присутній',
  absent: 'Відсутній',
  excused: 'Поважна причина',
  late: 'Запізнення',
  unknown: 'Не відмічено',
};
const STATUS_CLASS: Record<Status, string> = {
  present: 'bg-success/15 text-success',
  absent: 'bg-danger/15 text-danger',
  excused: 'bg-paper-200 text-ink-700 ring-1 ring-ink-300',
  late: 'bg-paper-200 text-ink-700',
  unknown: 'bg-paper-100 text-ink-400',
};

const DAY_LABEL = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function mondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  const dow = (d.day() + 6) % 7;
  return d.subtract(dow, 'day').startOf('day');
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const todayMonday = mondayOf(dayjs()).format('YYYY-MM-DD');
  const [weekIso, setWeekIso] = useState(todayMonday);
  const [picker, setPicker] = useState<{
    studentId: string;
    studentName: string;
    lessonId: string;
    subjectName: string;
    date: string;
    current: Status;
  } | null>(null);
  const [studentsMgr, setStudentsMgr] = useState(false);

  const membership = useActiveMembership();
  const isTeacherOnly = useIsTeacherOnly();
  // Optional subject-filter passed by the teacher home page: ?subjectIds=id1,id2
  const teacherSubjectIds = useMemo(() => {
    const raw = searchParams.get('subjectIds');
    if (!raw) return null;
    const ids = raw.split(',').filter(Boolean);
    return ids.length ? ids : null;
  }, [searchParams]);
  const teacherSubjectName = searchParams.get('subjectName');
  const teacherSubjectShortName = searchParams.get('subjectShortName');

  const autoTeacherSubjectFilter = isTeacherOnly && !teacherSubjectIds;
  const teacherSubjects = useQuery({
    queryKey: ['teacher-my-subjects'],
    queryFn: () => api<TeacherSubject[]>('/teachers/my-subjects'),
    enabled: autoTeacherSubjectFilter,
  });
  const teacherFilterReady =
    !autoTeacherSubjectFilter || teacherSubjects.isSuccess || teacherSubjects.isError;
  const teacherJournalSubjectId = useMemo(() => {
    return teacherSubjectIds?.[0] ?? teacherSubjects.data?.[0]?._id ?? null;
  }, [teacherSubjectIds, teacherSubjects.data]);
  const effectiveTeacherSubjectIds =
    teacherSubjectIds ?? (teacherSubjects.data?.map((s) => s._id) ?? null);

  // Journal is for head/deputy/teacher/admin only — students see a friendly stub.
  const hasJournalAccess = membership
    ? ['group_head', 'deputy_head', 'teacher', 'admin'].includes(membership.role)
    : isTeacherOnly; // pure-teacher fallback (no membership yet)

  const settings = useQuery({
    queryKey: ['group-settings'],
    queryFn: () => api<GroupSettings>('/groups/current/settings'),
    enabled: hasJournalAccess && !isTeacherOnly,
  });
  // Deputy/head can also manage the student list; teachers can only mark status.
  const canManageStudents = !!settings.data?.canEdit;
  // All journal-access roles (teacher, deputy, head, admin) can mark attendance.
  const canEdit = hasJournalAccess;

  const grid = useQuery({
    queryKey: ['attendance-grid', weekIso],
    queryFn: () =>
      api<WeekGrid>('/attendance/week-grid', {
        query: {
          weekStart: weekIso,
          subjectIds: teacherJournalSubjectId ?? undefined,
        },
      }),
    enabled: hasJournalAccess && teacherFilterReady,
  });

  const setStatus = useMutation({
    mutationFn: (params: { lessonId: string; date: string; userId: string; status: Status }) =>
      api('/attendance/entry', {
        method: 'PATCH',
        query: {
          subjectIds: teacherJournalSubjectId ?? undefined,
        },
        json: {
          scheduleLessonId: params.lessonId,
          date: params.date,
          userId: params.userId,
          status: params.status,
        },
      }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['attendance-grid', weekIso] });
    },
    onError: () => haptic('error'),
  });

  const data = grid.data;
  const weekStart = dayjs(weekIso);
  const weekEnd = weekStart.add(6, 'day');
  const isCurrentWeek = weekIso === todayMonday;

  // Build lookup: marks[studentId+lessonId] -> status
  const markMap = useMemo(() => {
    const m = new Map<string, Status>();
    for (const r of data?.marks ?? []) m.set(`${r.studentId}::${r.lessonId}`, r.status);
    return m;
  }, [data?.marks]);

  const sortedLessons = useMemo(() => {
    const all = [...(data?.lessons ?? [])].sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startTime.localeCompare(b.startTime);
    });
    // Teachers see only the lessons belonging to their assigned subjects.
    if (effectiveTeacherSubjectIds) {
      return all.filter((l) => {
        if (l.subjectId && effectiveTeacherSubjectIds.includes(l.subjectId)) return true;
        if (teacherSubjectName && matchesSubjectName(l.subjectName, teacherSubjectName)) return true;
        if (teacherSubjectShortName && matchesSubjectName(l.subjectName, teacherSubjectShortName)) return true;
        return false;
      });
    }
    return all;
  }, [data?.lessons, effectiveTeacherSubjectIds, teacherSubjectName, teacherSubjectShortName]);

  // Group lessons by day for the day-header row
  const dayGroups = useMemo(() => {
    const groups: Array<{ dow: number; date: string; count: number }> = [];
    for (const l of sortedLessons) {
      const last = groups[groups.length - 1];
      if (last && last.dow === l.dayOfWeek) {
        last.count += 1;
      } else {
        groups.push({ dow: l.dayOfWeek, date: l.date, count: 1 });
      }
    }
    return groups;
  }, [sortedLessons]);

  // Access guard goes AFTER all hooks (React rule: hooks must run unconditionally
  // in the same order on every render).
  if (!hasJournalAccess) {
    return (
      <div className="space-y-4">
        <PageHeader title="Журнал" />
        <div className="card text-sm text-ink-700 leading-relaxed">
          Журнал відвідуваності доступний лише старості, заступнику чи викладачам.
          Якщо ви маєте бачити журнал — попросіть старосту призначити вас заступником
          через «Налаштування групи».
        </div>
      </div>
    );
  }

  if (autoTeacherSubjectFilter && teacherSubjects.isLoading) {
    return <div className="card text-sm text-ink-500">Підтягуємо ваші предмети…</div>;
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Журнал"
        subtitle={`${data?.weekType === 1 ? 'перший' : 'другий'} тиждень`}
        action={
          <div className="flex gap-1.5">
            {canManageStudents ? (
              <button
                type="button"
                onClick={() => setStudentsMgr(true)}
                className="btn-secondary h-9 px-3 text-xs"
                title="Керувати списком студентів"
              >
                Студенти
              </button>
            ) : null}
            {!isCurrentWeek ? (
              <button
                type="button"
                onClick={() => setWeekIso(todayMonday)}
                className="btn-secondary h-9 px-3 text-xs"
                title="Перейти до поточного тижня"
              >
                Сьогодні
              </button>
            ) : null}
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <button
          className="btn-secondary h-9 w-9 p-0 text-base flex-shrink-0"
          onClick={() => setWeekIso(weekStart.subtract(1, 'week').format('YYYY-MM-DD'))}
          aria-label="Попередній тиждень"
        >
          ‹
        </button>
        <div className="flex-1 text-center font-medium tabular-nums">
          {weekStart.format('DD.MM')} — {weekEnd.format('DD.MM.YYYY')}
        </div>
        <button
          className="btn-secondary h-9 w-9 p-0 text-base flex-shrink-0"
          onClick={() => setWeekIso(weekStart.add(1, 'week').format('YYYY-MM-DD'))}
          aria-label="Наступний тиждень"
        >
          ›
        </button>
      </div>

      {grid.isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : grid.isError ? (
        <div className="card text-sm text-danger space-y-2">
          <p>{(grid.error as Error)?.message ?? 'Помилка завантаження журналу'}</p>
          <button
            type="button"
            className="btn-secondary h-8 px-3 text-xs"
            onClick={() => grid.refetch()}
          >
            Спробувати знову
          </button>
        </div>
      ) : !data ? (
        <div className="card text-sm text-ink-500">Немає даних.</div>
      ) : sortedLessons.length === 0 ? (
        <div className="card text-sm text-ink-500">
          {effectiveTeacherSubjectIds
            ? 'Для ваших предметів на цей тиждень немає занять.'
            : 'У цей тиждень пар немає або розклад не синхронізовано.'}
        </div>
      ) : data.students.length === 0 ? (
        <div className="card text-sm text-ink-500">У групі ще немає студентів.</div>
      ) : (
        <div className="card p-0 scroll-x-visible rounded-2xl">
          <table className="text-[12px] tabular-nums w-max min-w-full border-separate border-spacing-0">
            <thead>
              {/* Day-grouped header row */}
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 bg-paper-100 z-20 text-left font-semibold p-2 whitespace-nowrap border-b-2 border-paper-300"
                >
                  Студент
                </th>
                {dayGroups.map((g, i) => (
                  <th
                    key={`${g.dow}-${i}`}
                    colSpan={g.count}
                    className={cn(
                      'bg-paper-100 text-center text-[11px] font-bold uppercase tracking-wide py-1.5 border-b border-paper-300',
                      i > 0 && 'border-l-2 border-paper-300',
                    )}
                  >
                    <div className="text-ink-900">{DAY_LABEL[g.dow - 1]}</div>
                    <div className="text-[10px] font-medium text-ink-500 normal-case">
                      {dayjs(g.date).format('DD.MM')}
                    </div>
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className="font-semibold p-2 text-center bg-paper-200 sticky right-0 z-20 border-b-2 border-paper-300 min-w-[88px]"
                >
                  <div className="flex flex-col leading-tight">
                    <span>Тиждень</span>
                    <span className="text-[10px] text-ink-500 font-normal">всього</span>
                  </div>
                </th>
              </tr>
              {/* Lesson sub-header row */}
              <tr>
                {sortedLessons.map((l, idx) => {
                  const isDayStart = idx === 0 || sortedLessons[idx - 1].dayOfWeek !== l.dayOfWeek;
                  return (
                    <th
                      key={l._id}
                      className={cn(
                        'bg-paper-50 font-medium p-1.5 align-bottom border-b-2 border-paper-300 min-w-[78px]',
                        isDayStart && idx > 0 && 'border-l-2 border-paper-300',
                      )}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] text-ink-500 tabular-nums">
                          {l.startTime}
                        </span>
                        <span
                          className="font-semibold leading-tight max-w-[72px] truncate text-ink-900"
                          title={l.subjectName}
                        >
                          {abbr(l.subjectName, 12)}
                        </span>
                        <span className="text-[9px] text-ink-500 uppercase">
                          {lessonTypeShort(l.type)}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => {
                const w = data.perStudentWeek[s._id] ?? { absent: 0, excused: 0, late: 0 };
                const t = data.perStudentTotal[s._id] ?? { absent: 0, excused: 0, late: 0 };
                const wTotal = w.absent + w.excused + w.late;
                const tTotal = t.absent + t.excused + t.late;
                return (
                  <tr key={s._id} className="hover:bg-paper-50/60">
                    <td className="sticky left-0 bg-paper-50 z-10 p-2 font-medium align-top border-b border-paper-200 whitespace-nowrap">
                      <div title={s.fullName} className="flex items-center gap-1.5">
                        <span>{shortenName(s.fullName)}</span>
                        {s.isManual ? (
                          <span
                            className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-paper-200 text-ink-500 font-medium leading-4"
                            title="Доданий вручну старостою"
                          >
                            ручн.
                          </span>
                        ) : null}
                      </div>
                      {s.username ? (
                        <div className="text-[10px] text-ink-500">@{s.username}</div>
                      ) : null}
                    </td>
                    {sortedLessons.map((l, idx) => {
                      const status =
                        (markMap.get(`${s._id}::${l._id}`) ?? 'unknown') as Status;
                      const isDayStart =
                        idx === 0 || sortedLessons[idx - 1].dayOfWeek !== l.dayOfWeek;
                      return (
                        <td
                          key={l._id}
                          className={cn(
                            'p-1 text-center border-b border-paper-200',
                            isDayStart && idx > 0 && 'border-l-2 border-paper-300',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (!canEdit) return;
                              setPicker({
                                studentId: s._id,
                                studentName: shortenName(s.fullName),
                                lessonId: l._id,
                                subjectName: l.subjectName,
                                date: l.date,
                                current: status,
                              });
                            }}
                            disabled={!canEdit}
                            className={cn(
                              'inline-flex items-center justify-center h-7 min-w-[2rem] px-1.5 rounded-md font-semibold transition-colors',
                              STATUS_CLASS[status],
                              canEdit && 'hover:opacity-80 active:scale-95',
                            )}
                            title={STATUS_FULL[status]}
                          >
                            {STATUS_LABEL[status]}
                          </button>
                        </td>
                      );
                    })}
                    <td className="p-2 text-center bg-paper-100 sticky right-0 z-10 align-top border-b border-paper-200">
                      <div className="flex flex-col items-center leading-tight">
                        <span className={cn('font-semibold', wTotal > 0 ? 'text-danger' : 'text-ink-700')}>
                          {wTotal}
                        </span>
                        <span className="text-[10px] text-ink-500">всього {tTotal}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Per-lesson totals row */}
              <tr className="bg-paper-100 border-t-2 border-paper-300">
                <td className="sticky left-0 bg-paper-100 z-10 p-2 font-semibold border-t-2 border-paper-300">
                  Підсумок
                </td>
                {sortedLessons.map((l, idx) => {
                  const stats = data.perLessonWeek[l._id] ?? {
                    present: 0,
                    absent: 0,
                    excused: 0,
                    late: 0,
                  };
                  const isDayStart =
                    idx === 0 || sortedLessons[idx - 1].dayOfWeek !== l.dayOfWeek;
                  const missed = stats.absent + stats.excused;
                  return (
                    <td
                      key={l._id}
                      className={cn(
                        'p-1 text-center text-[10px] border-t-2 border-paper-300',
                        isDayStart && idx > 0 && 'border-l-2 border-paper-300',
                      )}
                    >
                      <div className="leading-tight">
                        {stats.absent ? (
                          <span className="text-danger font-semibold">{stats.absent}н </span>
                        ) : null}
                        {stats.excused ? (
                          <span className="text-ink-700 font-semibold">{stats.excused}п </span>
                        ) : null}
                        {stats.late ? (
                          <span className="text-ink-700 font-semibold">{stats.late}з</span>
                        ) : null}
                        {!missed && !stats.late ? (
                          <span className="text-ink-300">—</span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
                <td className="p-2 bg-paper-200 sticky right-0 z-10 text-center text-[10px] text-ink-500 border-t-2 border-paper-300">
                  Н / Пов / Зап
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <Legend />

      {picker ? (
        <StatusPicker
          subjectName={picker.subjectName}
          studentName={picker.studentName}
          current={picker.current}
          onPick={(s) => {
            setStatus.mutate({
              lessonId: picker.lessonId,
              date: picker.date,
              userId: picker.studentId,
              status: s,
            });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {studentsMgr ? (
        <StudentsManager
          weekIso={weekIso}
          allStudents={data?.students ?? []}
          onClose={() => setStudentsMgr(false)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['attendance-grid', weekIso] });
          }}
        />
      ) : null}
    </div>
  );
}

interface ManualStudent {
  _id: string;
  fullName: string;
}

function StudentsManager({
  weekIso,
  allStudents,
  onClose,
  onChanged,
}: {
  weekIso: string;
  allStudents: WeekGrid['students'];
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['manual-students'],
    queryFn: () => api<ManualStudent[]>('/manual-students'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['manual-students'] });
    onChanged();
  };

  const create = useMutation({
    mutationFn: (fullName: string) =>
      api<ManualStudent>('/manual-students', { method: 'POST', json: { fullName } }),
    onSuccess: () => {
      haptic('success');
      setNewName('');
      setError(null);
      invalidate();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  const update = useMutation({
    mutationFn: (params: { id: string; fullName: string }) =>
      api<ManualStudent>(`/manual-students/${params.id}`, {
        method: 'PATCH',
        json: { fullName: params.fullName },
      }),
    onSuccess: () => {
      haptic('success');
      setEditingId(null);
      setEditValue('');
      invalidate();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/manual-students/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Помилка');
      haptic('error');
    },
  });

  // Real Telegram members are read-only; placeholder entries can be edited/deleted.
  const realMembers = (allStudents ?? []).filter((s) => !s.isManual);
  const manualEntries = (list.data ?? []).slice().sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'uk'),
  );

  // Match manual → real user by name to surface the @handle in the manager too
  const usernameByName = new Map<string, string>();
  for (const s of realMembers) if (s.username) usernameByName.set(s.fullName.trim().toLowerCase(), s.username);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} role="button" aria-label="Закрити" />
      <div className="relative card w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-b-none sm:rounded-2xl pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:pb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-semibold">Список студентів</div>
            <div className="text-xs text-ink-500">Тиждень {dayjs(weekIso).format('DD.MM')}</div>
          </div>
          <button onClick={onClose} className="chip">✕</button>
        </div>

        <section className="space-y-2">
          <div className="text-[12px] uppercase tracking-wide text-ink-500 font-medium">
            Додати студента
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Прізвище Імʼя По-батькові"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) create.mutate(newName.trim());
              }}
            />
            <button
              type="button"
              className="btn-primary px-3"
              disabled={!newName.trim() || create.isPending}
              onClick={() => create.mutate(newName.trim())}
            >
              Додати
            </button>
          </div>
          {error ? <div className="text-sm text-danger">{error}</div> : null}
        </section>

        {manualEntries.length > 0 ? (
          <section className="mt-4 space-y-1.5">
            <div className="text-[12px] uppercase tracking-wide text-ink-500 font-medium">
              Додані вручну
            </div>
            {manualEntries.map((m) => {
              const tgUsername = usernameByName.get(m.fullName.trim().toLowerCase());
              const isEditing = editingId === m._id;
              return (
                <div
                  key={m._id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-paper-100 px-3 py-2"
                >
                  {isEditing ? (
                    <input
                      className="input flex-1 h-9"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && editValue.trim()) {
                          update.mutate({ id: m._id, fullName: editValue.trim() });
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                          setEditValue('');
                        }
                      }}
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{m.fullName}</div>
                      {tgUsername ? (
                        <div className="text-[11px] text-ink-500 truncate">@{tgUsername}</div>
                      ) : null}
                    </div>
                  )}

                  <div className="flex gap-1 flex-shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary h-8 px-2 text-xs"
                          disabled={!editValue.trim() || update.isPending}
                          onClick={() =>
                            update.mutate({ id: m._id, fullName: editValue.trim() })
                          }
                        >
                          Зберегти
                        </button>
                        <button
                          type="button"
                          className="btn-secondary h-8 px-2 text-xs"
                          onClick={() => {
                            setEditingId(null);
                            setEditValue('');
                          }}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-secondary h-8 px-2 text-xs"
                          onClick={() => {
                            setEditingId(m._id);
                            setEditValue(m.fullName);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="btn-secondary h-8 px-2 text-xs text-danger"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Видалити «${m.fullName}»?`)) {
                              remove.mutate(m._id);
                            }
                          }}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

        {realMembers.length > 0 ? (
          <section className="mt-4 space-y-1">
            <div className="text-[12px] uppercase tracking-wide text-ink-500 font-medium">
              Учасники Telegram
            </div>
            <div className="text-[11px] text-ink-500 mb-1.5">
              Зʼявляються автоматично, коли студент відкриває застосунок.
            </div>
            {realMembers.map((s) => (
              <div
                key={s._id}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{s.fullName}</div>
                  {s.username ? (
                    <div className="text-[11px] text-ink-500 truncate">@{s.username}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function StatusPicker({
  subjectName,
  studentName,
  current,
  onPick,
  onClose,
}: {
  subjectName: string;
  studentName: string;
  current: Status;
  onPick: (s: Status) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} role="button" aria-label="Закрити" />
      <div className="relative card w-full sm:max-w-sm rounded-b-none sm:rounded-2xl pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:pb-4">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{studentName}</div>
            <div className="text-xs text-ink-500 truncate">{subjectName}</div>
          </div>
          <button onClick={onClose} className="chip flex-shrink-0">✕</button>
        </div>
        <div className="space-y-1.5">
          {STATUS_CYCLE.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className={cn(
                'w-full flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors',
                s === current ? 'bg-ink-900 text-paper-50' : 'bg-paper-100 hover:bg-paper-200',
              )}
            >
              <span className="font-medium text-sm">{STATUS_FULL[s]}</span>
              <span
                className={cn(
                  'h-7 min-w-[2rem] px-1.5 rounded-md text-xs font-semibold flex items-center justify-center',
                  STATUS_CLASS[s],
                )}
              >
                {STATUS_LABEL[s]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <section className="card text-[11px] text-ink-500 flex flex-wrap gap-x-3 gap-y-1.5">
      <LegendItem s="present" />
      <LegendItem s="absent" />
      <LegendItem s="excused" />
      <LegendItem s="late" />
      <LegendItem s="unknown" />
    </section>
  );
}

function LegendItem({ s }: { s: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          'h-5 min-w-[1.5rem] px-1 rounded text-[10px] font-semibold flex items-center justify-center',
          STATUS_CLASS[s],
        )}
      >
        {STATUS_LABEL[s]}
      </span>
      <span>{STATUS_FULL[s]}</span>
    </span>
  );
}

function abbr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function lessonTypeShort(t: string): string {
  const m: Record<string, string> = {
    lecture: 'лек',
    practice: 'прак',
    lab: 'лаб',
    seminar: 'сем',
  };
  return m[t] ?? '';
}

function matchesSubjectName(currentName: string, expectedName: string): boolean {
  if (!currentName || !expectedName) return false;
  return currentName.trim().toLowerCase() === expectedName.trim().toLowerCase();
}
