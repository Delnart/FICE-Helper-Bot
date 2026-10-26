'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../../lib/api';
import { cn } from '../../../../../lib/cn';
import { PageHeader } from '../../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../../components/Empty';
import { Icon } from '../../../../../components/icons';
import { dueSoon, pluralUk } from '../../../../../components/subjects/helpers';

interface SubjectDetail {
  _id: string;
  name: string;
  shortName?: string;
  canManage: boolean;
  isTeacher: boolean;
}

interface HomeworkRow {
  _id: string;
  title: string;
  deadline?: string;
  done?: boolean;
  points?: number;
}

export default function SubjectHomeworkPage() {
  const { id } = useParams<{ id: string }>();
  const subject = useQuery({
    queryKey: ['subject', id],
    queryFn: () => api<SubjectDetail>(`/subjects/${id}`),
  });
  const hw = useQuery({
    queryKey: ['subject-hw', id],
    queryFn: () => api<HomeworkRow[]>('/homework', { query: { subjectId: id } }),
    enabled: !!id,
  });

  // Homework is community-managed — any group member can add/edit/delete.
  // Teachers also see the buttons (their group membership covers them).
  // We show the buttons whenever the subject loaded (i.e. user has access);
  // the server-side check rejects non-members anyway.
  const canManage = !!subject.data;
  const newHref = `/homework/new?subjectId=${id}` as Route;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Домашнє завдання"
        subtitle={subject.data ? subject.data.shortName ?? subject.data.name : undefined}
        action={
          canManage ? (
            <Link href={newHref} className="icon-btn" aria-label="Додати завдання">
              <Icon name="plus" size={22} />
            </Link>
          ) : undefined
        }
      />

      {hw.isLoading ? (
        <Loading />
      ) : hw.isError ? (
        <ErrorState
          error={hw.error}
          onRetry={() => hw.refetch()}
          title="Не вдалося завантажити завдання"
        />
      ) : hw.data && hw.data.length ? (
        <div>
          {hw.data.map((h) => {
            const overdue = !h.done && !!h.deadline && dayjs(h.deadline).isBefore(dayjs());
            const soon = h.done ? null : dueSoon(h.deadline);
            return (
              <Link key={h._id} href={`/homework/${h._id}`} className="row">
                <span className={cn('tile', h.done ? 'tile-lime' : 'tile-soft')}>
                  <Icon name={h.done ? 'check' : 'task'} size={22} strokeWidth={1.9} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="h3 truncate">{h.title}</span>
                  <div className="meta">
                    <span className={cn('tiny', overdue ? 'text-bad' : 'faint')}>
                      {h.deadline ? (
                        <>
                          до <span className="num whitespace-nowrap">{dayjs(h.deadline).format('DD.MM HH:mm')}</span>
                        </>
                      ) : (
                        'без дедлайну'
                      )}
                    </span>
                    {h.done ? <span className="chip chip-ok">Виконано</span> : null}
                    {soon && !overdue ? <span className="chip chip-warn">{soon}</span> : null}
                    {h.points ? (
                      <span className="chip">
                        {h.points} {pluralUk(h.points, ['бал', 'бали', 'балів'])}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Icon name="chevronRight" size={18} className="chev" />
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty
          title="Немає домашніх завдань"
          icon="task"
          hint={canManage ? 'Додайте перше завдання для цієї дисципліни' : undefined}
          action={
            canManage ? (
              <Link href={newHref} className="btn btn-primary btn-md">
                <Icon name="plus" size={18} /> Додати
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
