'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { Fragment, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { cn } from '../../../../lib/cn';
import { useMe } from '../../../../hooks/useMe';
import { useTelegramBackButton } from '../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../components/Empty';
import { Icon, type IconName } from '../../../../components/icons';
import { SubjectTile } from '../../../../components/SubjectIcon';
import { Section } from '../../../../components/ui/Section';
import { UserAvatar } from '../../../../components/UserAvatar';
import {
  LESSON_TYPE_LABEL,
  dueSoon,
  getLinkMeta,
  isLessonOf,
  isQueueOpen,
  pluralUk,
  queueBySubject,
  takenSlots,
  type NowLesson,
  type RawQueue,
} from '../../../../components/subjects/helpers';

interface SubjectDetail {
  _id: string;
  groupId: string;
  name: string;
  shortName?: string;
  icon?: string;
  isOnline?: boolean;
  teachers: Array<{
    fullName: string;
    role: string;
    roleInSubject?: string;
    telegramUsername?: string;
    avatarUrl?: string;
  }>;
  links: Array<{ label: string; url: string; lessonReminderType?: string }>;
  visibility: {
    homeworkVisible: boolean;
    queueVisible: boolean;
    linksVisible: boolean;
    teachersVisible: boolean;
  };
  canManage: boolean;
  isTeacher: boolean;
}

interface NowResponse {
  current: NowLesson | null;
  next: NowLesson | null;
}

interface HomeworkRow {
  _id: string;
  title: string;
  deadline?: string;
  done?: boolean;
  points?: number;
  teamSize?: number;
}

/** Queue entry statuses that no longer hold a place in line. */
const QUEUE_DONE = ['passed', 'missed', 'failed'];

export default function SubjectDetailPage() {
  useTelegramBackButton();
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const subject = useQuery({
    queryKey: ['subject', id],
    queryFn: () => api<SubjectDetail>(`/subjects/${id}`),
  });
  const now = useQuery({
    queryKey: ['schedule-now'],
    queryFn: () => api<NowResponse>('/schedule/now'),
  });

  const v = subject.data?.visibility;
  const canManage = !!subject.data?.canManage;
  const isTeacher = !!subject.data?.isTeacher;
  const journalHref = useMemo(() => {
    const params = new URLSearchParams({
      subjectIds: id,
      subjectName: subject.data?.name ?? '',
      subjectShortName: subject.data?.shortName ?? '',
    });
    return `/attendance?${params.toString()}` as Route;
  }, [id, subject.data?.name, subject.data?.shortName]);

  // Quick-card stats — same endpoints (and cache keys) as the queues / homework screens.
  const queues = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<RawQueue[]>('/queues'),
    enabled: !!v?.queueVisible,
  });
  const hw = useQuery({
    queryKey: ['subject-hw', id],
    queryFn: () => api<HomeworkRow[]>('/homework', { query: { subjectId: id } }),
    enabled: !!id && !!v?.homeworkVisible,
  });

  const isCurrent = !!subject.data && isLessonOf(now.data?.current, subject.data);
  const isNext = !!subject.data && isLessonOf(now.data?.next, subject.data);
  const liveLesson = isCurrent ? now.data?.current : isNext ? now.data?.next : null;

  if (subject.isLoading) return <Loading />;
  if (subject.isError || !subject.data) {
    return (
      <ErrorState
        error={subject.error}
        onRetry={() => subject.refetch()}
        title="Не вдалося завантажити дисципліну"
      />
    );
  }
  const s = subject.data;

  const queue = queueBySubject(queues.data).get(id);
  const queueOpen = !!queue && isQueueOpen(queue);
  // Earliest live place when the queue allows several entries per user.
  const myQueueEntry = queue?.entries
    ?.filter((e) => e.userId === me.data?._id && !QUEUE_DONE.includes(e.status ?? ''))
    .sort((a, b) => a.slotIndex - b.slotIndex)[0];
  const ahead =
    queue && myQueueEntry
      ? new Set(
          (queue.entries ?? [])
            .filter((e) => e.slotIndex < myQueueEntry.slotIndex && !QUEUE_DONE.includes(e.status ?? ''))
            .map((e) => e.slotIndex),
        ).size
      : 0;

  const hwPending = (hw.data ?? []).filter((h) => !h.done && h.teamSize !== 0);
  const hwNearest =
    hwPending.find((h) => h.deadline && new Date(h.deadline) >= new Date()) ?? hwPending[0];
  const hwSoon = dueSoon(hwNearest?.deadline);

  const liveInfo = liveLesson
    ? [
        liveLesson.type ? LESSON_TYPE_LABEL[liveLesson.type] ?? liveLesson.type : null,
        liveLesson.room,
        isCurrent ? `до ${liveLesson.endTime}` : `${liveLesson.startTime}–${liveLesson.endTime}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const hasCards = !!(v?.queueVisible || v?.homeworkVisible || isTeacher);
  // Links are shown once — in the «Корисні посилання» section; editors (same rule as
  // the links page) still get a way in when the list is empty.
  const canEditLinks = canManage || isTeacher;
  const linksHref = `/subjects/${id}/links` as Route;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3.5">
        <SubjectTile name={s.name} icon={s.icon} size="lg" tone="ink" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="h1 break-words text-[20px]">{s.name}</h1>
          {liveLesson || s.isOnline ? (
            <div className="meta">
              {liveLesson ? (
                <>
                  <span className={cn('chip', isCurrent ? 'chip-lime' : 'chip-info')}>
                    {isCurrent ? 'зараз триває' : 'наступна пара'}
                  </span>
                  <span className="chip max-w-full">
                    <span className="truncate">{liveInfo}</span>
                  </span>
                </>
              ) : null}
              {s.isOnline ? <span className="chip chip-info">онлайн</span> : null}
            </div>
          ) : null}
        </div>
        {canManage ? (
          <Link
            href={`/subjects/${id}/edit`}
            className="icon-btn self-start"
            aria-label="Редагувати дисципліну"
          >
            <Icon name="edit" />
          </Link>
        ) : null}
      </header>

      {hasCards ? (
        <section
          aria-label="Розділи дисципліни"
          className="grid grid-cols-2 gap-2.5 [&>*:last-child:nth-child(odd)]:col-span-2"
        >
          {v?.queueVisible ? (
            <QuickCard
              href={`/subjects/${id}/queue` as Route}
              icon="list"
              accent={queueOpen}
              badge={
                queue ? (
                  <span className={cn('chip', queueOpen && 'bg-[rgba(255,255,255,0.22)] text-accent-ink')}>
                    {queueOpen ? 'відкрита' : 'закрита'}
                  </span>
                ) : null
              }
              value={myQueueEntry ? `№ ${myQueueEntry.slotIndex}` : undefined}
              title="Черга на здачу"
              sub={
                queue
                  ? `${takenSlots(queue)} із ${queue.slotsCount} місць` +
                    (myQueueEntry ? ` · перед вами ${ahead}` : '')
                  : 'Запис на лабораторні'
              }
            />
          ) : null}
          {v?.homeworkVisible ? (
            <QuickCard
              href={`/subjects/${id}/homework` as Route}
              icon="task"
              badge={hwSoon ? <span className="chip chip-warn">{hwSoon}</span> : null}
              value={hw.data ? String(hwPending.length) : undefined}
              title="Завдання"
              sub={
                hwNearest
                  ? [
                      hwNearest.title,
                      hwNearest.points
                        ? `${hwNearest.points} ${pluralUk(hwNearest.points, ['бал', 'бали', 'балів'])}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : hw.data?.length
                    ? 'Усе виконано'
                    : 'Перегляд та додавання'
              }
            />
          ) : null}
          {/* Teacher-only actions (head/deputy use the global /attendance directly).
              Journal goes to the same /attendance grid as the head sees, but
              filtered to this subject — so teacher and head share the same data. */}
          {isTeacher ? (
            <>
              <QuickCard
                href={journalHref}
                icon="calendarCheck"
                title="Журнал відвідуваності"
                sub="Облік присутності студентів"
              />
              <QuickCard
                href={`/subjects/${id}/students` as Route}
                icon="users"
                title="Список студентів"
                sub="Контакти у Telegram"
              />
            </>
          ) : null}
        </section>
      ) : null}

      {/* Teachers — collapsed by person: one row per teacher with all
          their roles in this subject (Лектор · Практика · Лаборант). */}
      {v?.teachersVisible ? (
        <Section title="Викладачі">
          {s.teachers.length > 0 ? (
            mergeTeachers(s.teachers).map((t) => <TeacherRow key={t.dedupeKey} t={t} />)
          ) : (
            <Empty title="Викладачів ще не призначено" icon="users" />
          )}
        </Section>
      ) : null}

      {v?.linksVisible && (s.links.length || canEditLinks) ? (
        <Section
          title="Корисні посилання"
          aside={
            s.links.length > 3 || (canEditLinks && s.links.length) ? (
              <Link
                href={linksHref}
                className="-my-[13px] inline-block py-[13px] font-semibold text-accent-text"
              >
                {s.links.length > 3 ? `Усі ${s.links.length}` : 'Змінити'}
              </Link>
            ) : null
          }
        >
          {s.links.length ? (
            <div className="card-flat flex flex-col px-3.5 py-1">
              {s.links.slice(0, 3).map((l, i) => {
                const meta = getLinkMeta(l.url);
                const type = l.lessonReminderType && LINK_TYPE_LABEL[l.lessonReminderType];
                // Skip the type when the label already says it («Практика» · практика).
                const sub = [meta.host, type && !l.label.toLowerCase().includes(type.slice(0, 5)) && type]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Fragment key={`${i}-${l.url}`}>
                    {i ? <div className="divider" /> : null}
                    <a href={meta.href} target="_blank" rel="noopener noreferrer" className="row-plain">
                      <span className="subj subj-sm">
                        <Icon name={linkIcon(meta.host, l.lessonReminderType)} strokeWidth={1.9} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="h3 truncate">{l.label}</span>
                        {sub ? <span className="tiny faint truncate">{sub}</span> : null}
                      </div>
                      <Icon name="arrowUpRight" size={18} className="chev" />
                    </a>
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <Link href={linksHref} className="row">
              <span className="subj subj-sm">
                <Icon name="plus" strokeWidth={1.9} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="h3">Додати посилання</span>
                <span className="tiny faint">Moodle, Drive, методички, Zoom</span>
              </div>
              <Icon name="chevronRight" size={18} className="chev" />
            </Link>
          )}
        </Section>
      ) : null}
    </div>
  );
}

function QuickCard({
  href,
  icon,
  title,
  sub,
  value,
  badge,
  accent,
}: {
  href: Route;
  icon: IconName;
  title: string;
  sub?: string;
  value?: string;
  badge?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'card-flat flex min-h-[128px] flex-col gap-3.5 p-3.5',
        accent && 'border-accent bg-accent text-accent-ink',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon name={icon} size={22} className={accent ? undefined : 'text-accent-text'} />
        {badge}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        {value ? <span className="num text-[22px] leading-none">{value}</span> : null}
        <span className="h3">{title}</span>
        {sub ? <span className={cn('tiny line-clamp-2', accent ? 'opacity-[0.85]' : 'faint')}>{sub}</span> : null}
      </div>
    </Link>
  );
}

interface MergedTeacher {
  dedupeKey: string;
  fullName: string;
  telegramUsername?: string;
  avatarUrl?: string;
  roles: string[]; // ordered: lecturer, practice, lab
}

/**
 * Group teacher entries by person (username or fullName) so a single instructor
 * with multiple roles in this subject shows up as one row with a list of roles.
 */
function mergeTeachers(teachers: SubjectDetail['teachers']): MergedTeacher[] {
  const ROLE_ORDER = ['lecturer', 'practice', 'lab'];
  const map = new Map<string, MergedTeacher>();
  for (const t of teachers) {
    const key = (t.telegramUsername || t.fullName).toLowerCase().trim();
    const role = (t.roleInSubject ?? t.role).toLowerCase();
    const cur = map.get(key);
    if (cur) {
      if (!cur.roles.includes(role)) cur.roles.push(role);
      cur.avatarUrl ??= t.avatarUrl;
    } else {
      map.set(key, {
        dedupeKey: key,
        fullName: t.fullName,
        telegramUsername: t.telegramUsername,
        avatarUrl: t.avatarUrl,
        roles: [role],
      });
    }
  }
  // Stable role order (lecturer first, then practice, then lab)
  for (const t of map.values()) {
    t.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  }
  return [...map.values()];
}

function TeacherRow({ t }: { t: MergedTeacher }) {
  const username = t.telegramUsername?.replace(/^@/, '');
  const tgUrl = username ? `https://t.me/${username}` : null;

  const body = (
    <>
      <UserAvatar name={t.fullName} src={t.avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="h3 break-words">{t.fullName}</span>
        <div className="flex flex-wrap gap-1">
          {t.roles.map((r) => (
            <span key={r} className="chip chip-accent h-5 text-[11px]">
              {teacherRoleLabel(r)}
            </span>
          ))}
        </div>
      </div>
    </>
  );

  if (!tgUrl) {
    return (
      <div className="row">
        {body}
        <span className="tiny faint max-w-[110px] flex-shrink-0">контакти не вказані</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="row w-full text-left"
      onClick={() => window.open(tgUrl, '_blank', 'noopener,noreferrer')}
    >
      {body}
      <span className="chip flex-shrink-0 gap-1">
        <Icon name="send" size={14} /> Написати
      </span>
    </button>
  );
}

function teacherRoleLabel(r: string): string {
  const m: Record<string, string> = {
    lecturer: 'Лектор',
    practice: 'Практика',
    lab: 'Лабораторні',
  };
  return m[r.toLowerCase()] ?? r;
}

/** Lesson type a link is tagged with (reminder setting), shown after the host. */
const LINK_TYPE_LABEL: Record<string, string> = {
  lecture: 'лекції',
  practice: 'практика',
  lab: 'лабораторні',
};

/** Row icon for a link: by well-known host, else by its lesson type. */
function linkIcon(host: string, type?: string): IconName {
  if (/moodle|do\.ipo|campus/i.test(host)) return 'bookOpen';
  if (/docs\.google/i.test(host)) return 'file';
  if (/zoom|meet\.google|teams|youtu/i.test(host)) return 'video';
  if (/github|gitlab/i.test(host)) return 'code';
  if (/^t\.me$|telegram/i.test(host)) return 'send';
  if (type === 'lab') return 'flask';
  return 'link';
}
