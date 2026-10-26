'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Icon } from '../../../components/icons';
import { Sheet } from '../../../components/ui/Sheet';
import { haptic } from '../../../lib/telegram';
import { cn } from '../../../lib/cn';
import { initials, shortenName } from '../../../lib/name';
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
  excused: 'Пв',
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
  present: 'on-ok',
  absent: 'on-bad',
  excused: 'on-info',
  late: 'on-warn',
  unknown: '',
};
const LEGEND: Array<{ s: Status; dot: string; text: string }> = [
  { s: 'present', dot: 'bg-ok', text: 'присутній' },
  { s: 'absent', dot: 'bg-bad', text: 'відсутній' },
  { s: 'late', dot: 'bg-warn', text: 'запізнився' },
  { s: 'excused', dot: 'bg-info', text: 'поважна причина' },
  { s: 'unknown', dot: 'bg-line-2', text: 'не відмічено' },
];

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
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
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
    // The subject filter is part of the key: Home caches the unfiltered grid under ['attendance-grid', weekIso].
    queryKey: ['attendance-grid', weekIso, teacherJournalSubjectId ?? null],
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
  const weekRange =
    (weekStart.month() === weekEnd.month()
      ? `${weekStart.format('D')}–${weekEnd.format('D MMMM')}`
      : `${weekStart.format('D MMMM')} – ${weekEnd.format('D MMMM')}`) +
    (weekEnd.year() !== dayjs().year() ? ` ${weekEnd.format('YYYY')}` : '');

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

  // Discipline chips (client-side column filter).
  const subjectOptions = useMemo(
    () => Array.from(new Set(sortedLessons.map((l) => l.subjectName))),
    [sortedLessons],
  );
  const activeSubject =
    subjectFilter && subjectOptions.includes(subjectFilter) ? subjectFilter : null;
  const visibleLessons = useMemo(
    () => (activeSubject ? sortedLessons.filter((l) => l.subjectName === activeSubject) : sortedLessons),
    [sortedLessons, activeSubject],
  );

  // Group lessons by day for the day-header row
  const dayGroups = useMemo(() => {
    const groups: Array<{ dow: number; date: string; count: number }> = [];
    for (const l of visibleLessons) {
      const last = groups[groups.length - 1];
      if (last && last.dow === l.dayOfWeek) {
        last.count += 1;
      } else {
        groups.push({ dow: l.dayOfWeek, date: l.date, count: 1 });
      }
    }
    return groups;
  }, [visibleLessons]);

  // Summary tiles over the visible lessons.
  const summary = useMemo(() => {
    const t = { present: 0, absent: 0, excused: 0, late: 0 };
    for (const l of visibleLessons) {
      const s = data?.perLessonWeek[l._id];
      if (!s) continue;
      t.present += s.present;
      t.absent += s.absent;
      t.excused += s.excused;
      t.late += s.late;
    }
    const marked = t.present + t.absent + t.excused + t.late;
    return {
      rate: marked ? Math.round(((t.present + t.late) / marked) * 100) : null,
      missed: t.absent + t.excused,
      late: t.late,
    };
  }, [visibleLessons, data?.perLessonWeek]);

  // Access guard goes AFTER all hooks (React rule: hooks must run unconditionally
  // in the same order on every render).
  if (!hasJournalAccess) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Журнал" />
        <Empty
          icon="users"
          title="Журнал недоступний"
          hint="Журнал відвідуваності доступний лише старості, заступнику чи викладачам. Якщо ви маєте бачити журнал — попросіть старосту призначити вас заступником через «Налаштування групи»."
        />
      </div>
    );
  }

  if (autoTeacherSubjectFilter && teacherSubjects.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Журнал" />
        <Loading label="Підтягуємо ваші дисципліни…" />
      </div>
    );
  }

  const isDayStart = (idx: number) =>
    idx > 0 && visibleLessons[idx - 1].dayOfWeek !== visibleLessons[idx].dayOfWeek;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Журнал"
        subtitle={[membership?.groupName, data ? `${data.weekType === 1 ? 'I' : 'II'} тиждень` : null]
          .filter(Boolean)
          .join(' · ') || undefined}
        action={
          <>
            {!isCurrentWeek ? (
              <button
                type="button"
                onClick={() => setWeekIso(todayMonday)}
                className="btn btn-outline btn-sm"
                title="Перейти до поточного тижня"
              >
                Сьогодні
              </button>
            ) : null}
            {canManageStudents ? (
              <button
                type="button"
                onClick={() => setStudentsMgr(true)}
                className="btn btn-outline btn-sm"
                title="Керувати списком студентів"
              >
                <Icon name="users" size={16} />
                Студенти
              </button>
            ) : null}
          </>
        }
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setWeekIso(weekStart.subtract(1, 'week').format('YYYY-MM-DD'))}
          aria-label="Попередній тиждень"
        >
          <Icon name="chevronLeft" />
        </button>
        <div className="flex flex-1 flex-col items-center">
          <span className="num whitespace-nowrap text-[15px]">{weekRange}</span>
          {isCurrentWeek ? <span className="tiny faint">поточний тиждень</span> : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setWeekIso(weekStart.add(1, 'week').format('YYYY-MM-DD'))}
          aria-label="Наступний тиждень"
        >
          <Icon name="chevronRight" />
        </button>
      </div>

      {subjectOptions.length > 1 ? (
        // One horizontally scrolling row: full names stay readable without wrapping into many lines.
        <div className="scroll-x -mx-4 flex gap-1.5 px-4" role="group" aria-label="Дисципліна">
          <button
            type="button"
            className={cn('chip chip-btn flex-shrink-0', !activeSubject && 'chip-ink')}
            aria-pressed={!activeSubject}
            onClick={() => setSubjectFilter(null)}
          >
            Усі дисципліни
          </button>
          {subjectOptions.map((name) => (
            <button
              key={name}
              type="button"
              className={cn('chip chip-btn max-w-[75vw] flex-shrink-0', activeSubject === name && 'chip-ink')}
              aria-pressed={activeSubject === name}
              title={name}
              onClick={() => setSubjectFilter(activeSubject === name ? null : name)}
            >
              <span className="min-w-0 truncate">{name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {grid.isLoading ? (
        <Loading />
      ) : grid.isError && !data ? (
        <ErrorState title="Не вдалося завантажити журнал" error={grid.error} onRetry={() => grid.refetch()} />
      ) : !data ? (
        <Empty title="Немає даних" />
      ) : sortedLessons.length === 0 ? (
        <Empty
          icon="calendar"
          title={
            effectiveTeacherSubjectIds
              ? 'Для ваших дисциплін на цей тиждень немає занять.'
              : 'У цей тиждень пар немає або розклад не синхронізовано.'
          }
        />
      ) : data.students.length === 0 ? (
        <Empty icon="users" title="У групі ще немає студентів." />
      ) : (
        <>
          {setStatus.isError ? (
            <div className="card-flat small text-bad" role="alert">
              {setStatus.error.message || 'Не вдалося зберегти відмітку'}
            </div>
          ) : null}
          <section className="grid grid-cols-3 gap-2">
            <div className="card-flat flex flex-col gap-0.5 px-3.5 py-3">
              <span className="num text-[22px] leading-none text-ok">
                {summary.rate === null ? '—' : `${summary.rate}%`}
              </span>
              <span className="tiny faint">присутність</span>
            </div>
            <div className="card-flat flex flex-col gap-0.5 px-3.5 py-3">
              <span className="num text-[22px] leading-none text-bad">{summary.missed}</span>
              <span className="tiny faint">пропусків</span>
            </div>
            <div className="card-flat flex flex-col gap-0.5 px-3.5 py-3">
              <span className="num text-[22px] leading-none text-warn">{summary.late}</span>
              <span className="tiny faint">запізнення</span>
            </div>
          </section>

          <section className="card-flat overflow-hidden p-0" aria-label="Таблиця відвідуваності">
            <div className="scroll-x">
              <table className="w-full min-w-[358px] border-collapse">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      rowSpan={2}
                      className="sticky left-0 z-10 w-[118px] border-b border-line bg-surface px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3"
                    >
                      Студент
                    </th>
                    {dayGroups.map((g, i) => (
                      <th
                        key={`${g.dow}-${i}`}
                        colSpan={g.count}
                        className={cn('px-0.5 pt-2 text-center', i > 0 && 'border-l border-line')}
                      >
                        <span className="tiny faint whitespace-nowrap uppercase">
                          {DAY_LABEL[g.dow - 1]} <span className="num">{dayjs(g.date).format('DD.MM')}</span>
                        </span>
                      </th>
                    ))}
                    <th
                      scope="col"
                      rowSpan={2}
                      className="sticky right-0 z-10 w-14 border-b border-l border-line bg-surface px-1.5 py-2 text-center"
                      title="Пропуски за тиждень / всього"
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">Тижд.</span>
                        <span className="tiny faint">всього</span>
                      </div>
                    </th>
                  </tr>
                  <tr className="border-b border-line">
                    {visibleLessons.map((l, idx) => (
                      <th
                        key={l._id}
                        scope="col"
                        className={cn('w-10 px-0.5 pb-2 pt-1 align-bottom', isDayStart(idx) && 'border-l border-line')}
                        title={`${l.subjectName} · ${l.startTime}–${l.endTime}`}
                      >
                        <div className="flex flex-col items-center gap-px">
                          <span className="small max-w-[52px] truncate font-bold">{acronym(l.subjectName)}</span>
                          <span className="num whitespace-nowrap text-[10px] text-ink-3">{l.startTime}</span>
                          {lessonTypeShort(l.type) ? (
                            <span className="text-[10px] uppercase text-ink-3">{lessonTypeShort(l.type)}</span>
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => {
                    const w = data.perStudentWeek[s._id] ?? { absent: 0, excused: 0, late: 0 };
                    const t = data.perStudentTotal[s._id] ?? { absent: 0, excused: 0, late: 0 };
                    const wTotal = w.absent + w.excused + w.late;
                    const tTotal = t.absent + t.excused + t.late;
                    const short = shortenName(s.fullName);
                    const sub = [s.isManual ? 'вручну' : null, s.username ? `@${s.username}` : null]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <tr key={s._id} className="border-b border-line">
                        <th
                          scope="row"
                          title={s.isManual ? `${s.fullName} — доданий вручну старостою` : s.fullName}
                          className="sticky left-0 z-10 max-w-[118px] bg-surface px-3 py-1 text-left"
                        >
                          <div className="truncate text-[14px] font-semibold">{short}</div>
                          {sub ? <div className="tiny faint max-w-[110px] truncate font-normal">{sub}</div> : null}
                        </th>
                        {visibleLessons.map((l, idx) => {
                          const status = (markMap.get(`${s._id}::${l._id}`) ?? 'unknown') as Status;
                          return (
                            <td
                              key={l._id}
                              className={cn('px-0.5 py-[3px] text-center', isDayStart(idx) && 'border-l border-line')}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (!canEdit) return;
                                  setPicker({
                                    studentId: s._id,
                                    studentName: short,
                                    lessonId: l._id,
                                    subjectName: l.subjectName,
                                    date: l.date,
                                    current: status,
                                  });
                                }}
                                disabled={!canEdit}
                                className={cn('st h-10 w-9 min-w-[36px] p-0', STATUS_CLASS[status])}
                                title={STATUS_FULL[status]}
                                aria-label={`${short}, ${DAY_LABEL[l.dayOfWeek - 1]} ${l.subjectName}: ${STATUS_FULL[status].toLowerCase()}`}
                              >
                                {STATUS_LABEL[status]}
                              </button>
                            </td>
                          );
                        })}
                        <td className="sticky right-0 z-10 border-l border-line bg-surface px-1.5 text-center">
                          <div className="flex flex-col items-center leading-tight">
                            <span className={cn('num text-[15px]', wTotal > 0 ? 'text-bad' : 'text-ink-2')}>
                              {wTotal}
                            </span>
                            <span className="tiny faint whitespace-nowrap">
                              всього <span className="num">{tTotal}</span>
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {/* Per-lesson totals row */}
                  <tr className="bg-surface-2">
                    <th scope="row" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left text-[13px] font-semibold">
                      Підсумок
                    </th>
                    {visibleLessons.map((l, idx) => {
                      const stats = data.perLessonWeek[l._id] ?? { present: 0, absent: 0, excused: 0, late: 0 };
                      const missed = stats.absent + stats.excused;
                      return (
                        <td
                          key={l._id}
                          className={cn(
                            'num px-0.5 py-2 text-center text-[10px] leading-tight',
                            isDayStart(idx) && 'border-l border-line',
                          )}
                        >
                          {stats.absent ? <div className="text-bad">{stats.absent}н</div> : null}
                          {stats.excused ? <div className="text-info">{stats.excused}пв</div> : null}
                          {stats.late ? <div className="text-warn">{stats.late}з</div> : null}
                          {!missed && !stats.late ? <span className="text-ink-3">—</span> : null}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 border-l border-line bg-surface-2 px-1.5 text-center text-[10px] leading-tight text-ink-3">
                      н / пв / з
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
              <span className="small faint">
                Студентів: <span className="num">{data.students.length}</span>
              </span>
              {canEdit ? (
                <span className="small text-right font-semibold text-accent-text">
                  Торкніться клітинки, щоб змінити
                </span>
              ) : null}
            </div>
          </section>
        </>
      )}

      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 px-0.5">
        {LEGEND.map((it) => (
          <span key={it.s} className="tiny inline-flex items-center gap-[5px]">
            <span className={cn('dot', it.dot)} />
            {STATUS_LABEL[it.s]} {it.text}
          </span>
        ))}
      </div>

      {picker ? (
        <StatusPicker
          subjectName={picker.subjectName}
          studentName={picker.studentName}
          date={picker.date}
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

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  return (
    <Sheet open onClose={onClose} title="Список студентів">
      <div className="small muted -mt-2">
        Тиждень <span className="num">{dayjs(weekIso).format('DD.MM')}</span>
      </div>

      {list.isError ? (
        <ErrorState title="Не вдалося завантажити список" error={list.error} onRetry={() => list.refetch()} />
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="eyebrow">Додати студента</div>
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
            className="btn btn-primary"
            disabled={!newName.trim() || create.isPending}
            onClick={() => create.mutate(newName.trim())}
          >
            Додати
          </button>
        </div>
        {error ? <div className="small text-bad">{error}</div> : null}
      </section>

      {manualEntries.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="eyebrow">Додані вручну</div>
          <div className="flex flex-col">
            {manualEntries.map((m, i) => {
              const tgUsername = usernameByName.get(m.fullName.trim().toLowerCase());
              const isEditing = editingId === m._id;
              return (
                <div key={m._id}>
                  {i > 0 ? <div className="divider" /> : null}
                  <div className="row-plain gap-2">
                    {isEditing ? (
                      <input
                        className="input h-11 flex-1"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editValue.trim()) {
                            update.mutate({ id: m._id, fullName: editValue.trim() });
                          } else if (e.key === 'Escape') {
                            cancelEdit();
                          }
                        }}
                      />
                    ) : (
                      <>
                        <span className="avatar">{initials(m.fullName)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="h3 truncate">{m.fullName}</div>
                          {tgUsername ? <div className="tiny faint truncate">@{tgUsername}</div> : null}
                        </div>
                      </>
                    )}

                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Зберегти"
                          disabled={!editValue.trim() || update.isPending}
                          onClick={() => update.mutate({ id: m._id, fullName: editValue.trim() })}
                        >
                          <Icon name="check" />
                        </button>
                        <button type="button" className="icon-btn-plain" aria-label="Скасувати" onClick={cancelEdit}>
                          <Icon name="close" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="icon-btn-plain"
                          aria-label={`Перейменувати «${m.fullName}»`}
                          onClick={() => {
                            setEditingId(m._id);
                            setEditValue(m.fullName);
                          }}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn-plain text-bad"
                          aria-label={`Видалити «${m.fullName}»`}
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Видалити «${m.fullName}»?`)) {
                              remove.mutate(m._id);
                            }
                          }}
                        >
                          <Icon name="trash" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {realMembers.length > 0 ? (
        <section className="flex flex-col gap-1">
          <div className="eyebrow">Учасники Telegram</div>
          <div className="tiny faint">Зʼявляються автоматично, коли студент відкриває застосунок.</div>
          <div className="flex flex-col">
            {realMembers.map((s, i) => (
              <div key={s._id}>
                {i > 0 ? <div className="divider" /> : null}
                <div className="row-plain">
                  <span className="avatar">{initials(s.fullName)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="h3 truncate">{s.fullName}</div>
                    {s.username ? <div className="tiny faint truncate">@{s.username}</div> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Sheet>
  );
}

function StatusPicker({
  subjectName,
  studentName,
  date,
  current,
  onPick,
  onClose,
}: {
  subjectName: string;
  studentName: string;
  date: string;
  current: Status;
  onPick: (s: Status) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open onClose={onClose} title={studentName}>
      <div className="small muted -mt-2 truncate">
        {subjectName} · <span className="num">{dayjs(date).format('dd, DD.MM')}</span>
      </div>
      <div className="flex flex-col" role="radiogroup" aria-label="Статус">
        {STATUS_CYCLE.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === current}
            onClick={() => onPick(s)}
            className={cn('row w-full text-left', s === current && 'border-accent bg-accent-soft')}
          >
            <span className={cn('st pointer-events-none', STATUS_CLASS[s])}>{STATUS_LABEL[s]}</span>
            <span className="flex-1 font-semibold">{STATUS_FULL[s]}</span>
            {s === current ? <Icon name="check" className="text-accent-text" /> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** "Операційні системи" → "ОС", "Алгоритми та структури даних" → "АСД", "Фізика" → "Фіз". */
function acronym(name: string): string {
  const words = name.split(/[\s\-–—.,()]+/).filter((w) => w.length > 2);
  if (words.length < 2) return name.trim().slice(0, 3);
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 4);
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
