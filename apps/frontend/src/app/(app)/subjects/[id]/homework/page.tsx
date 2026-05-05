'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { Empty } from '../../../../../components/Empty';

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

  // Teachers can manage homework too (Backend's homework canManage uses
  // ROLE_LEVEL >= Teacher, so the actions go through; the UI just needs to
  // show the buttons).
  const canManage = !!(subject.data?.canManage || subject.data?.isTeacher);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Домашнє завдання"
        subtitle={subject.data ? subject.data.shortName ?? subject.data.name : undefined}
        action={
          canManage ? (
            <Link
              href={`/homework/new?subjectId=${id}`}
              className="btn-primary h-9 px-3 text-sm"
            >
              + Додати
            </Link>
          ) : undefined
        }
      />

      {hw.isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : hw.data && hw.data.length ? (
        <div className="space-y-2">
          {hw.data.map((h) => (
            <Link
              key={h._id}
              href={`/homework/${h._id}`}
              className="card flex items-center justify-between hover:bg-paper-100"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{h.title}</div>
                <div className="text-sm text-ink-500">
                  {h.deadline
                    ? `до ${dayjs(h.deadline).format('DD.MM HH:mm')}`
                    : 'без дедлайну'}
                </div>
              </div>
              {h.done ? (
                <span className="chip bg-success/10 text-success">Виконано</span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="Немає домашніх завдань"
          hint={canManage ? 'Натисніть «+ Додати»' : undefined}
        />
      )}
    </div>
  );
}
