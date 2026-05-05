'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Empty } from '../../../components/Empty';
import { cn } from '../../../lib/cn';

interface QueueCard {
  _id: string;
  title: string;
  subjectId: string;
  subjectName?: string;
  status: 'draft' | 'open' | 'closed';
  rules?: { isOpen?: boolean };
}

const STATUS_LABEL: Record<QueueCard['status'], string> = {
  draft: 'Чернетка',
  open: 'Відкрита',
  closed: 'Закрита',
};
const STATUS_CLASS: Record<QueueCard['status'], string> = {
  draft: 'bg-paper-200 text-ink-500',
  open: 'bg-success/10 text-success',
  closed: 'bg-ink-100 text-ink-500',
};

export default function QueuesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<QueueCard[]>('/queues'),
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Черги" />
      {isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : data && data.length ? (
        <div className="space-y-2">
          {data.map((q) => {
            const status = q.status ?? (q.rules?.isOpen ? 'open' : 'closed');
            return (
              <Link
                key={q._id}
                href={`/subjects/${q.subjectId}/queue`}
                className="card flex items-center justify-between hover:bg-paper-100"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{q.title}</div>
                  {q.subjectName ? (
                    <div className="text-sm text-ink-500 truncate">{q.subjectName}</div>
                  ) : null}
                </div>
                <span className={cn('chip', STATUS_CLASS[status])}>{STATUS_LABEL[status]}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty title="Черг ще немає" />
      )}
    </div>
  );
}
