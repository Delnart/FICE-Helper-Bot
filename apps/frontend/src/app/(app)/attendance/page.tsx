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
import { UserAvatar } from '../../../components/UserAvatar';
import { getWebApp, haptic } from '../../../lib/telegram';
import { cn } from '../../../lib/cn';
import { shortenName, subjectAcronym } from '../../../lib/name';
import { useActiveMembership, useIsTeacherOnly } from '../../../hooks/useMe';

dayjs.locale('uk');

type Status = 'present' | 'absent' | 'excused' | 'late' | 'unknown';
type Period = 'week' | 'month' | 'semester';
type Counts = { present: number; absent: number; excused: number; late: number };

interface Student {
  _id: string;
  fullName: string;
  username?: string;
  isManual?: boolean;
  avatarUrl?: string;
}

interface WeekGrid {
  weekStart: string;
  weekType: 1 | 2;
  lessons: Array<{
    _id: string;
    subjectId?: string;
    subjectName: string;
    subjectShortName?: string;
    type: string;
    dayOfWeek: number;
    lessonNumber: number;
    startTime: string;
    endTime: string;
    date: string;
  }>;
  students: Student[];
  marks: Array<{ studentId: string; lessonId: string; date: string; status: Status }>;
  perStudentWeek: Record<string, { absent: number; excused: number; late: number }>;
  perStudentTotal: Record<string, { absent: number; excused: number; late: number }>;
  perLessonWeek: Record<string, Counts>;
}

/** GET /attendance/period — marks summed per student per discipline over [from, to). */
interface PeriodGrid {
  from: string;
  to: string;
  subjects: Array<{ subjectId?: string; subjectName: string; subjectShortName?: string }>;
  students: Student[];
  cells: Record<string, Record<string, Counts>>;
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

/** One journal column: a lesson (week) or a discipline (month / semester). */
interface Column {
  key: string;
  day?: string;
  label: string;
  sub?: string;
  title: string;
  dayStart: boolean;
  totals: Counts;
  cell: (s: Student) => { text: string; cls: string; tip: string; aria: string; onClick: () => void };
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
];
const PERIOD_LEGEND: Array<{ dot: string; text: string }> = [
  { dot: 'bg-bad', text: 'є пропуски без причини' },
  { dot: 'bg-info', text: 'лише з поважної' },
  { dot: 'bg-warn', text: 'лише запізнення' },
  { dot: 'bg-ok', text: 'без пропусків' },
];

const PERIODS: Array<{ k: Period; label: string; unit: string; unitGen: string }> = [
  { k: 'week', label: 'Тиждень', unit: 'тиждень', unitGen: 'тижня' },
  { k: 'month', label: 'Місяць', unit: 'місяць', unitGen: 'місяця' },
  { k: 'semester', label: 'Семестр', unit: 'семестр', unitGen: 'семестру' },
];

const DAY_LABEL = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const ZERO: Counts = { present: 0, absent: 0, excused: 0, late: 0 };

function mondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  const dow = (d.day() + 6) % 7;
  return d.subtract(dow, 'day').startOf('day');
}

/** [from, to) of the period containing `d`. KPI semesters: autumn Sep–Jan (with the session), spring Feb–Aug. */
function periodRange(p: Period, d: dayjs.Dayjs): [dayjs.Dayjs, dayjs.Dayjs] {
  if (p === 'week') {
    const from = mondayOf(d);
    return [from, from.add(7, 'day')];
  }
  if (p === 'month') {
    const from = d.startOf('month');
    return [from, from.add(1, 'month')];
  }
  const m = d.month();
  if (m >= 1 && m <= 7) return [dayjs(`${d.year()}-02-01`), dayjs(`${d.year()}-09-01`)];
  const y = m === 0 ? d.year() - 1 : d.year();
  return [dayjs(`${y}-09-01`), dayjs(`${y + 1}-02-01`)];
}

function periodLabel(p: Period, from: dayjs.Dayjs): string {
  if (p === 'week') {
    // Mon–Sat, like the mockup ("20–25 жовтня"): KPI has no Sunday lessons.
    const end = from.add(5, 'day');
    return (
      (from.month() === end.month()
        ? `${from.format('D')}–${end.format('D MMMM')}`
        : `${from.format('D MMMM')} – ${end.format('D MMMM')}`) +
      (end.year() !== dayjs().year() ? ` ${end.format('YYYY')}` : '')
    );
  }
  if (p === 'month') {
    const s = from.format('MMMM YYYY');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return from.month() === 8
    ? `Осінній семестр ${from.year()}/${String(from.year() + 1).slice(2)}`
    : `Весняний семестр ${from.year() - 1}/${String(from.year()).slice(2)}`;
}

function addCounts(a: Counts, b?: Counts): Counts {
  if (!b) return a;
  return { present: a.present + b.present, absent: a.absent + b.absent, excused: a.excused + b.excused, late: a.late + b.late };
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const todayIso = dayjs().format('YYYY-MM-DD');
  const [period, setPeriod] = useState<Period>('week');
  // Any day inside the shown period; switching week → month keeps the same moment in time.
  const [anchorIso, setAnchorIso] = useState(todayIso);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    studentId: string;
    studentName: string;
    lessonId: string;
    subjectName: string;
    date: string;
    current: Status;
  } | null>(null);
  const [detail, setDetail] = useState<{ studentName: string; subjectName: string; counts?: Counts } | null>(null);
  const [studentsMgr, setStudentsMgr] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const isWeek = period === 'week';
  const periodMeta = PERIODS.find((p) => p.k === period)!;
  const [from, to] = periodRange(period, dayjs(anchorIso));
  const fromIso = from.format('YYYY-MM-DD');
  const toIso = to.format('YYYY-MM-DD');
  const weekIso = mondayOf(dayjs(anchorIso)).format('YYYY-MM-DD');
  const isCurrent = fromIso <= todayIso && todayIso < toIso;
  const rangeLabel = periodLabel(period, from);

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
  // Teachers see only their assigned subjects (by id, or by the name passed from their home page).
  const isOwnSubject = (s: { subjectId?: string; subjectName: string }) =>
    !effectiveTeacherSubjectIds ||
    (!!s.subjectId && effectiveTeacherSubjectIds.includes(s.subjectId)) ||
    (!!teacherSubjectName && matchesSubjectName(s.subjectName, teacherSubjectName)) ||
    (!!teacherSubjectShortName && matchesSubjectName(s.subjectName, teacherSubjectShortName));

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
    enabled: isWeek && hasJournalAccess && teacherFilterReady,
  });

  const periodQ = useQuery({
    queryKey: ['attendance-period', fromIso, toIso, teacherJournalSubjectId ?? null],
    queryFn: () =>
      api<PeriodGrid>('/attendance/period', {
        query: { from: fromIso, to: toIso, subjectIds: teacherJournalSubjectId ?? undefined },
      }),
    enabled: !isWeek && hasJournalAccess && teacherFilterReady,
  });

  const refreshJournal = () => {
    qc.invalidateQueries({ queryKey: ['attendance-grid', weekIso] });
    qc.invalidateQueries({ queryKey: ['attendance-period'] });
  };

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
      refreshJournal();
    },
    onError: () => haptic('error'),
  });

  const data = grid.data;
  const pdata = periodQ.data;
  const query = isWeek ? grid : periodQ;
  const students = (isWeek ? data?.students : pdata?.students) ?? [];

  // Build lookup: marks[studentId+lessonId] -> status
  const markMap = useMemo(() => {
    const m = new Map<string, Status>();
    for (const r of data?.marks ?? []) m.set(`${r.studentId}::${r.lessonId}`, r.status);
    return m;
  }, [data?.marks]);

  const sortedLessons = [...(data?.lessons ?? [])]
    .sort((a, b) => (a.dayOfWeek !== b.dayOfWeek ? a.dayOfWeek - b.dayOfWeek : a.startTime.localeCompare(b.startTime)))
    .filter(isOwnSubject);
  const periodSubjects = (pdata?.subjects ?? []).filter(isOwnSubject);
  const hasColumns = isWeek ? sortedLessons.length > 0 : periodSubjects.length > 0;

  // Discipline chips (client-side column filter); the head's short name when the discipline has one.
  const subjectOptions: Array<{ name: string; short?: string }> = [];
  for (const s of isWeek ? sortedLessons : periodSubjects) {
    if (!subjectOptions.some((o) => o.name === s.subjectName)) {
      subjectOptions.push({ name: s.subjectName, short: s.subjectShortName });
    }
  }
  const activeSubject =
    subjectFilter && subjectOptions.some((o) => o.name === subjectFilter) ? subjectFilter : null;
  const shown = <T extends { subjectName: string }>(list: T[]) =>
    activeSubject ? list.filter((x) => x.subjectName === activeSubject) : list;

  const columns: Column[] = isWeek
    ? shown(sortedLessons).map((l, idx, list) => {
        const day = DAY_LABEL[l.dayOfWeek - 1];
        return {
          key: l._id,
          day,
          label: l.subjectShortName || subjectAcronym(l.subjectName),
          sub: lessonTypeShort(l.type),
          title: `${l.subjectName} · ${day} ${dayjs(l.date).format('DD.MM')} · ${l.startTime}–${l.endTime}`,
          dayStart: idx > 0 && list[idx - 1].dayOfWeek !== l.dayOfWeek,
          totals: data?.perLessonWeek[l._id] ?? ZERO,
          cell: (s) => {
            const status = markMap.get(`${s._id}::${l._id}`) ?? 'unknown';
            const short = shortenName(s.fullName);
            return {
              text: STATUS_LABEL[status],
              cls: STATUS_CLASS[status],
              tip: STATUS_FULL[status],
              aria: `${short}, ${day} ${l.subjectName}: ${STATUS_FULL[status].toLowerCase()}`,
              onClick: () => {
                if (!canEdit) return;
                setPicker({
                  studentId: s._id,
                  studentName: short,
                  lessonId: l._id,
                  subjectName: l.subjectName,
                  date: l.date,
                  current: status,
                });
              },
            };
          },
        };
      })
    : shown(periodSubjects).map((sub) => ({
        key: sub.subjectName,
        label: sub.subjectShortName || subjectAcronym(sub.subjectName),
        title: sub.subjectName,
        dayStart: false,
        totals: students.reduce((t, s) => addCounts(t, pdata?.cells[s._id]?.[sub.subjectName]), ZERO),
        cell: (s) => {
          const c = pdata?.cells[s._id]?.[sub.subjectName];
          const missed = c ? c.absent + c.excused : 0;
          const short = shortenName(s.fullName);
          const tip = c ? `н ${c.absent} · пв ${c.excused} · з ${c.late} · п ${c.present}` : 'Немає відміток';
          return {
            text: c ? String(missed) : '·',
            cls: !c ? '' : c.absent ? 'on-bad' : c.excused ? 'on-info' : c.late ? 'on-warn' : 'on-ok',
            tip,
            aria: `${short}, ${sub.subjectName}: ${tip}`,
            onClick: () => setDetail({ studentName: short, subjectName: sub.subjectName, counts: c }),
          };
        },
      }));

  // Summary tiles over the visible columns.
  const totals = columns.reduce((t, c) => addCounts(t, c.totals), ZERO);
  const marked = totals.present + totals.absent + totals.excused + totals.late;
  const summary = {
    rate: marked ? Math.round(((totals.present + totals.late) / marked) * 100) : null,
    missed: totals.absent + totals.excused,
    late: totals.late,
  };

  /** Right sticky column: week — missed this week / ever; month & semester — missed (н+пв) / attendance %. */
  const rowTotal = (s: Student): { big: number; second: string } => {
    if (isWeek) {
      const w = data?.perStudentWeek[s._id] ?? ZERO;
      const t = data?.perStudentTotal[s._id] ?? ZERO;
      return { big: w.absent + w.excused + w.late, second: String(t.absent + t.excused + t.late) };
    }
    const c = columns.reduce((acc, col) => addCounts(acc, pdata?.cells[s._id]?.[col.key]), ZERO);
    const n = c.present + c.absent + c.excused + c.late;
    return { big: c.absent + c.excused, second: n ? `${Math.round(((c.present + c.late) / n) * 100)}%` : '—' };
  };

  // Access guard goes AFTER all hooks (React rule: hooks must run unconditionally
  // in the same order on every render).
  if (!hasJournalAccess) {
    return (
      <div className="flex flex-col gap-3.5">
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
      <div className="flex flex-col gap-3.5">
        <PageHeader title="Журнал" />
        <Loading label="Підтягуємо ваші дисципліни…" />
      </div>
    );
  }

  const exportRows = (): string[][] => [
    [['Журнал', membership?.groupName, rangeLabel, activeSubject].filter(Boolean).join(' · ')],
    [
      'Студент',
      ...columns.map((c) => c.title),
      ...(isWeek ? ['Пропуски за тиждень', 'Пропуски всього'] : ['Пропуски (н+пв)', 'Присутність']),
    ],
    ...students.map((s) => {
      const t = rowTotal(s);
      return [
        s.fullName,
        ...columns.map((c) => {
          const text = c.cell(s).text;
          return text === '·' ? '' : text;
        }),
        String(t.big),
        t.second,
      ];
    }),
  ];

  const ready = !!query.data && hasColumns && students.length > 0;
  const manageAction = canManageStudents ? (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => setStudentsMgr(true)}>
      <Icon name="users" size={16} />
      Список студентів
    </button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        title="Журнал"
        subtitle={[membership?.groupName, rangeLabel, isWeek && data ? `${data.weekType === 1 ? 'I' : 'II'} тиждень` : null]
          .filter(Boolean)
          .join(' · ')}
        action={
          // The student list manager lives in the table footer ("Студентів: N") so the header matches the mockup.
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="btn btn-outline btn-sm"
            disabled={!ready}
            title="Скопіювати чи завантажити таблицю"
          >
            <Icon name="download" size={16} />
            Експорт
          </button>
        }
      />

      <div className="seg" role="tablist" aria-label="Період">
        {PERIODS.map((p) => (
          <button
            key={p.k}
            type="button"
            role="tab"
            aria-selected={period === p.k}
            className={cn(period === p.k && 'on')}
            onClick={() => {
              haptic('selection');
              setPeriod(p.k);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAnchorIso(from.subtract(1, 'day').format('YYYY-MM-DD'))}
          aria-label={`Попередній ${periodMeta.unit}`}
        >
          <Icon name="chevronLeft" />
        </button>
        {/* The range itself is in the header subtitle (mockup); here only where we are relative to today. */}
        {isCurrent ? (
          <span className="small muted min-w-0 flex-1 text-center font-semibold">Поточний {periodMeta.unit}</span>
        ) : (
          <button
            type="button"
            className="small min-h-11 min-w-0 flex-1 font-semibold text-accent-text"
            onClick={() => setAnchorIso(todayIso)}
          >
            До поточного {periodMeta.unitGen}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAnchorIso(to.format('YYYY-MM-DD'))}
          aria-label={`Наступний ${periodMeta.unit}`}
        >
          <Icon name="chevronRight" />
        </button>
      </div>

      {subjectOptions.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Дисципліна">
          <button
            type="button"
            className={cn('chip chip-btn', !activeSubject && 'chip-ink')}
            aria-pressed={!activeSubject}
            onClick={() => setSubjectFilter(null)}
          >
            Усі дисципліни
          </button>
          {subjectOptions.map((o) => (
            <button
              key={o.name}
              type="button"
              className={cn('chip chip-btn max-w-full', activeSubject === o.name && 'chip-ink')}
              aria-pressed={activeSubject === o.name}
              aria-label={o.name}
              title={o.name}
              onClick={() => setSubjectFilter(activeSubject === o.name ? null : o.name)}
            >
              {/* Same short label as the column headers, like the mockup ("ОС", "БД"). */}
              <span className="min-w-0 truncate">{o.short || subjectAcronym(o.name)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {query.isLoading ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <ErrorState title="Не вдалося завантажити журнал" error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <Empty title="Немає даних" />
      ) : !hasColumns ? (
        <Empty
          icon="calendar"
          title={
            !isWeek
              ? effectiveTeacherSubjectIds
                ? 'У розкладі немає ваших дисциплін.'
                : 'Розклад групи ще не синхронізовано.'
              : effectiveTeacherSubjectIds
                ? 'Для ваших дисциплін на цей тиждень немає занять.'
                : 'У цей тиждень пар немає або розклад не синхронізовано.'
          }
          action={manageAction}
        />
      ) : students.length === 0 ? (
        <Empty icon="users" title="У групі ще немає студентів." action={manageAction} />
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
                  <tr className="border-b border-line">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 w-[118px] bg-surface px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3"
                    >
                      Студент
                    </th>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={cn('w-10 px-0.5 py-2 align-bottom', c.dayStart && 'border-l border-line')}
                        title={c.title}
                      >
                        <div className="flex flex-col items-center gap-px">
                          {c.day ? <span className="tiny faint uppercase">{c.day}</span> : null}
                          <span className="small max-w-[52px] truncate font-bold">{c.label}</span>
                          {c.sub ? <span className="text-[10px] uppercase text-ink-3">{c.sub}</span> : null}
                        </div>
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="sticky right-0 z-10 w-14 border-l border-line bg-surface px-1.5 py-2 text-center"
                      title={isWeek ? 'Пропуски за тиждень / всього' : 'Пропуски (н + пв) / присутність'}
                    >
                      <div className="flex flex-col items-center leading-tight">
                        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">
                          {isWeek ? 'Тижд.' : 'Разом'}
                        </span>
                        <span className="tiny faint">{isWeek ? 'всього' : 'н+пв'}</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const t = rowTotal(s);
                    const sub = [s.isManual ? 'вручну' : null, s.username ? `@${s.username}` : null]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <tr key={s._id} className="border-b border-line">
                        <th
                          scope="row"
                          title={s.isManual ? `${s.fullName} — доданий вручну старостою` : s.fullName}
                          className="sticky left-0 z-10 h-[46px] max-w-[118px] bg-surface px-3 py-1 text-left"
                        >
                          <div className="truncate text-[14px] font-semibold">{shortenName(s.fullName)}</div>
                          {sub ? <div className="tiny faint max-w-[110px] truncate font-normal">{sub}</div> : null}
                        </th>
                        {columns.map((c) => {
                          const cell = c.cell(s);
                          return (
                            <td
                              key={c.key}
                              className={cn('px-0.5 py-[3px] text-center', c.dayStart && 'border-l border-line')}
                            >
                              <button
                                type="button"
                                onClick={cell.onClick}
                                disabled={!canEdit}
                                className={cn('st h-10 w-9 min-w-[36px] p-0', cell.cls)}
                                title={cell.tip}
                                aria-label={cell.aria}
                              >
                                {cell.text}
                              </button>
                            </td>
                          );
                        })}
                        <td className="sticky right-0 z-10 border-l border-line bg-surface px-1.5 text-center">
                          <div className="flex flex-col items-center leading-tight">
                            <span className={cn('num text-[15px]', t.big > 0 ? 'text-bad' : 'text-ink-2')}>{t.big}</span>
                            <span className="tiny faint whitespace-nowrap">
                              {isWeek ? 'всього ' : ''}
                              <span className="num">{t.second}</span>
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {/* Per-column totals row */}
                  <tr className="bg-surface-2">
                    <th scope="row" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left text-[13px] font-semibold">
                      Підсумок
                    </th>
                    {columns.map((c) => {
                      const st = c.totals;
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            'num px-0.5 py-2 text-center text-[10px] leading-tight',
                            c.dayStart && 'border-l border-line',
                          )}
                        >
                          {st.absent ? <div className="text-bad">{st.absent}н</div> : null}
                          {st.excused ? <div className="text-info">{st.excused}пв</div> : null}
                          {st.late ? <div className="text-warn">{st.late}з</div> : null}
                          {!st.absent && !st.excused && !st.late ? <span className="text-ink-3">—</span> : null}
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
              {canManageStudents ? (
                <button
                  type="button"
                  onClick={() => setStudentsMgr(true)}
                  className="small faint -my-2.5 inline-flex min-h-11 flex-shrink-0 items-center gap-1"
                  title="Керувати списком студентів"
                >
                  Студентів: <span className="num">{students.length}</span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ) : (
                <span className="small faint">
                  Студентів: <span className="num">{students.length}</span>
                </span>
              )}
              {!isWeek ? (
                <span className="small font-semibold text-accent-text">Торкніться клітинки — деталі</span>
              ) : canEdit ? (
                <span className="small font-semibold text-accent-text">
                  Торкніться клітинки, щоб змінити
                </span>
              ) : null}
            </div>
          </section>
        </>
      )}

      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 px-0.5">
        {isWeek
          ? LEGEND.map((it) => (
              <span key={it.s} className="tiny inline-flex items-center gap-[5px]">
                <span className={cn('dot', it.dot)} />
                {STATUS_LABEL[it.s]} {it.text}
              </span>
            ))
          : (
            <>
              <span className="tiny faint w-full">Число в клітинці — пропуски (н + пв) за {periodMeta.unit}</span>
              {PERIOD_LEGEND.map((it) => (
                <span key={it.dot} className="tiny inline-flex items-center gap-[5px]">
                  <span className={cn('dot', it.dot)} />
                  {it.text}
                </span>
              ))}
            </>
          )}
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

      {detail ? (
        <Sheet open onClose={() => setDetail(null)} title={detail.studentName}>
          <div className="small muted -mt-2 truncate">
            {detail.subjectName} · {rangeLabel}
          </div>
          <div className="flex flex-col">
            {(['present', 'absent', 'late', 'excused'] as const).map((k, i) => (
              <div key={k}>
                {i > 0 ? <div className="divider" /> : null}
                <div className="row-plain">
                  <span className={cn('st pointer-events-none', STATUS_CLASS[k])}>{STATUS_LABEL[k]}</span>
                  <span className="flex-1 font-semibold">{STATUS_FULL[k]}</span>
                  <span className="num text-[17px]">{detail.counts?.[k] ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}

      {exportOpen ? (
        <ExportSheet
          title={['Журнал', membership?.groupName, fromIso].filter(Boolean).join(' ')}
          caption={[rangeLabel, activeSubject ?? 'усі дисципліни', `студентів: ${students.length}`].join(' · ')}
          rows={exportRows()}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {studentsMgr ? (
        <StudentsManager
          weekIso={weekIso}
          allStudents={students}
          onClose={() => setStudentsMgr(false)}
          onChanged={refreshJournal}
        />
      ) : null}
    </div>
  );
}

/** Copy as TSV (pastes straight into Google Sheets / Excel cells) or download a CSV. */
function ExportSheet({
  title,
  caption,
  rows,
  onClose,
}: {
  title: string;
  caption: string;
  rows: string[][];
  onClose: () => void;
}) {
  const [done, setDone] = useState<'copied' | 'downloaded' | 'failed' | null>(null);
  // Mobile Telegram webviews silently ignore file downloads — offer only the clipboard there.
  const canDownload = !/android|ios/i.test(getWebApp()?.platform ?? '');

  const finish = (ok: boolean, what: 'copied' | 'downloaded') => {
    setDone(ok ? what : 'failed');
    haptic(ok ? 'success' : 'error');
  };

  const copy = async () => {
    const tsv = rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      return finish(true, 'copied');
    } catch {
      // Older webviews: fall back to a hidden textarea + execCommand.
    }
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    finish(ok, 'copied');
  };

  const download = () => {
    // `;` + BOM: Excel with a Ukrainian locale splits columns and reads Cyrillic; Google Sheets auto-detects.
    const csv = rows
      .map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';'))
      .join('\r\n');
    try {
      const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      finish(true, 'downloaded');
    } catch {
      finish(false, 'downloaded');
    }
  };

  return (
    <Sheet open onClose={onClose} title="Експорт журналу">
      <div className="small muted -mt-2">{caption}</div>
      <div className="flex flex-col">
        <button type="button" className="row w-full text-left" onClick={() => void copy()}>
          <span className="tile tile-soft">
            <Icon name="copy" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="h3">Скопіювати таблицю</span>
            <span className="tiny faint">Вставте в Google Таблиці чи Excel — колонки розкладуться самі</span>
          </span>
        </button>
        {canDownload ? (
          <button type="button" className="row w-full text-left" onClick={download}>
            <span className="tile tile-soft">
              <Icon name="download" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="h3">Завантажити .csv</span>
              <span className="tiny faint">Файл для Excel чи Google Таблиць</span>
            </span>
          </button>
        ) : null}
      </div>
      {done === 'copied' ? (
        <div className="small font-semibold text-ok" role="status">Скопійовано — вставте в таблицю.</div>
      ) : done === 'downloaded' ? (
        <div className="small font-semibold text-ok" role="status">
          Файл .csv надіслано на завантаження. Не зʼявився — скопіюйте таблицю.
        </div>
      ) : done === 'failed' ? (
        <div className="small font-semibold text-bad" role="alert">Не вдалося. Спробуйте інший спосіб.</div>
      ) : null}
    </Sheet>
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
  allStudents: Student[];
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
                        <UserAvatar name={m.fullName} />
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
                  <UserAvatar name={s.fullName} src={s.avatarUrl} />
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
