'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { Empty } from '../../../../components/Empty';
import { cn } from '../../../../lib/cn';

interface SubjectDetail {
  _id: string;
  groupId: string;
  name: string;
  shortName?: string;
  teachers: Array<{
    fullName: string;
    role: string;
    roleInSubject?: string;
    telegramUsername?: string;
  }>;
  links: Array<{ label: string; url: string }>;
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
  current: { subjectName: string; startTime: string; endTime: string; room?: string } | null;
  next: { subjectName: string; startTime: string; endTime: string; room?: string } | null;
}

export default function SubjectDetailPage() {
  const { id } = useParams<{ id: string }>();
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

  const isCurrent =
    subject.data && now.data?.current && matchSubject(now.data.current.subjectName, subject.data);
  const isNext =
    subject.data && now.data?.next && matchSubject(now.data.next.subjectName, subject.data);
  const liveLesson = isCurrent ? now.data?.current : isNext ? now.data?.next : null;
  const liveLabel = isCurrent ? 'Зараз триває' : 'Наступна пара';

  if (subject.isLoading || !subject.data) {
    return <div className="card text-sm text-ink-500">Завантаження…</div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={subject.data.shortName ?? subject.data.name}
        subtitle={
          subject.data.shortName && subject.data.name !== subject.data.shortName
            ? subject.data.name
            : undefined
        }
        action={
          canManage ? (
            <Link
              href={`/subjects/${id}/edit`}
              className="btn-secondary h-9 px-3 text-sm"
              aria-label="Редагувати предмет"
            >
              Редагувати
            </Link>
          ) : undefined
        }
      />

      {liveLesson ? (
        <section
          className={cn(
            'card',
            isCurrent ? 'bg-ink-900 text-paper-50 border-ink-900' : '',
          )}
        >
          <div
            className={cn(
              'text-[12px] uppercase tracking-wide',
              isCurrent ? 'text-paper-300/80' : 'text-ink-500',
            )}
          >
            {liveLabel}
          </div>
          <div className={cn('text-sm mt-1', isCurrent ? 'text-paper-300' : 'text-ink-500')}>
            {liveLesson.startTime} – {liveLesson.endTime}
            {liveLesson.room ? ` · ${liveLesson.room}` : ''}
          </div>
        </section>
      ) : null}

      {/* Teacher cards — collapsed by person: one card per teacher with all
          their roles in this subject (Лектор · Практика · Лаборант). */}
      {v?.teachersVisible ? (
        subject.data.teachers.length > 0 ? (
          <div className="space-y-2">
            {mergeTeachers(subject.data.teachers).map((t) => (
              <TeacherCard key={t.dedupeKey} t={t} />
            ))}
          </div>
        ) : (
          <Empty title="Викладачів ще не призначено" />
        )
      ) : null}

      {/* Actions */}
      <section className="space-y-2">
        <h2 className="text-[15px] font-semibold tracking-tight">Дії</h2>
        <div className="space-y-2">
          {/* Teacher-only actions (head/deputy use the global /attendance directly).
              Journal goes to the same /attendance grid as the head sees, but
              filtered to this subject — so teacher and head share the same data. */}
          {isTeacher ? (
            <>
              <ActionRow href={journalHref} icon="Ж" title="Журнал відвідуваності" subtitle="Облік присутності студентів" />
              <ActionRow
                href={`/subjects/${id}/students` as Route}
                icon="С"
                title="Список студентів"
                subtitle="Контакти у Telegram"
              />
            </>
          ) : null}

          {v?.linksVisible ? (
            <ActionRow
              href={`/subjects/${id}/links` as Route}
              icon="L"
              title="Корисні посилання"
              subtitle={
                subject.data.links.length
                  ? subject.data.links.map((l) => l.label).slice(0, 3).join(', ')
                  : 'Поки немає'
              }
            />
          ) : null}
          {v?.queueVisible ? (
            <ActionRow
              href={`/subjects/${id}/queue` as Route}
              icon="Q"
              title="Черга на здачу"
              subtitle="Запис на лабораторні"
            />
          ) : null}
          {v?.homeworkVisible ? (
            <ActionRow
              href={`/subjects/${id}/homework` as Route}
              icon="H"
              title="Домашнє завдання"
              subtitle="Перегляд та додавання"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

interface MergedTeacher {
  dedupeKey: string;
  fullName: string;
  telegramUsername?: string;
  roles: string[]; // ordered: lecturer, practice, lab
}

/**
 * Group teacher entries by person (username or fullName) so a single instructor
 * with multiple roles in this subject shows up as one card with a list of roles.
 */
function mergeTeachers(
  teachers: Array<{
    fullName: string;
    role: string;
    roleInSubject?: string;
    telegramUsername?: string;
  }>,
): MergedTeacher[] {
  const ROLE_ORDER = ['lecturer', 'practice', 'lab'];
  const map = new Map<string, MergedTeacher>();
  for (const t of teachers) {
    const key = (t.telegramUsername || t.fullName).toLowerCase().trim();
    const role = (t.roleInSubject ?? t.role).toLowerCase();
    const cur = map.get(key);
    if (cur) {
      if (!cur.roles.includes(role)) cur.roles.push(role);
    } else {
      map.set(key, {
        dedupeKey: key,
        fullName: t.fullName,
        telegramUsername: t.telegramUsername,
        roles: [role],
      });
    }
  }
  // Stable role order (lecturer first, then practice, then lab)
  for (const t of map.values()) {
    t.roles.sort(
      (a, b) => (ROLE_ORDER.indexOf(a) + 100) - (ROLE_ORDER.indexOf(b) + 100),
    );
  }
  return [...map.values()];
}

function TeacherCard({ t }: { t: MergedTeacher }) {
  const tgUrl = t.telegramUsername
    ? `https://t.me/${t.telegramUsername.replace(/^@/, '')}`
    : null;

  const handleClick = (e: React.MouseEvent) => {
    if (tgUrl) {
      window.open(tgUrl, '_blank', 'noopener,noreferrer');
      e.preventDefault();
    }
  };

  const hasContact = !!tgUrl;

  return (
    <div
      className={cn(
        'card flex items-start justify-between gap-3',
        hasContact && 'hover:bg-paper-100 cursor-pointer transition-colors',
      )}
      onClick={hasContact ? handleClick : undefined}
      role={hasContact ? 'button' : undefined}
      tabIndex={hasContact ? 0 : undefined}
      onKeyDown={
        hasContact
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (tgUrl) window.open(tgUrl, '_blank', 'noopener,noreferrer');
              }
            }
          : undefined
      }
    >
      <div className="min-w-0 flex-1">
        <div className="inline-flex items-center flex-wrap gap-1 mb-1.5">
          {t.roles.map((r) => (
            <span
              key={r}
              className="text-[10px] uppercase tracking-wider font-semibold rounded-md px-1.5 py-0.5 bg-accent-soft text-accent"
            >
              {teacherRoleLabel(r)}
            </span>
          ))}
        </div>
        <div className="font-semibold truncate">{t.fullName}</div>
        {tgUrl ? (
          <div className="text-xs text-ink-500 mt-0.5 truncate">@{t.telegramUsername!.replace(/^@/, '')}</div>
        ) : (
          <div className="text-xs text-ink-300 mt-0.5">Контакти не вказані</div>
        )}
      </div>
      {hasContact ? (
        <span className="text-ink-300 mt-0.5 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

function ActionRow({
  href,
  icon,
  title,
  subtitle,
}: {
  href: Route;
  icon: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className="card flex items-center justify-between gap-3 hover:bg-paper-100 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span
          className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-[15px] flex-shrink-0 bg-accent-soft text-accent"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="font-semibold truncate">{title}</div>
          {subtitle ? (
            <div className="text-xs text-ink-500 truncate">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <span className="text-ink-300 flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  );
}

function teacherRoleLabel(r: string): string {
  const m: Record<string, string> = {
    lecturer: 'Лектор',
    practice: 'Практика',
    lab: 'Лаборант',
    Lecturer: 'Лектор',
    Practice: 'Практика',
    Lab: 'Лаборант',
  };
  return m[r] ?? r;
}

function matchSubject(currentName: string, subject: { name: string; shortName?: string }): boolean {
  if (!currentName) return false;
  const a = currentName.trim().toLowerCase();
  if (a === subject.name.trim().toLowerCase()) return true;
  if (subject.shortName && a === subject.shortName.trim().toLowerCase()) return true;
  return false;
}
