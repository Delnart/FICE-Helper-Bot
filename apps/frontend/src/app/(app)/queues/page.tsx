'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Icon } from '../../../components/icons';
import { SubjectTile } from '../../../components/SubjectIcon';

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

export default function QueuesPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<QueueCard[]>('/queues'),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Черги" />
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} title="Не вдалося завантажити черги" />
      ) : data && data.length ? (
        <div className="flex flex-col">
          {data.map((q) => {
            const status = q.status ?? (q.rules?.isOpen ? 'open' : 'closed');
            return (
              <Link key={q._id} href={`/subjects/${q.subjectId}/queue`} className="row">
                <SubjectTile name={q.subjectName ?? q.title} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="h3 truncate">{q.title}</span>
                  {q.subjectName ? (
                    <span className="tiny faint truncate">{q.subjectName}</span>
                  ) : null}
                </div>
                {status === 'open' ? (
                  <span className="chip chip-ok">
                    <span className="dot bg-ok" />
                    {STATUS_LABEL[status]}
                  </span>
                ) : (
                  <span className="chip">{STATUS_LABEL[status]}</span>
                )}
                <Icon name="chevronRight" className="chev" />
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty title="Черг ще немає" icon="users" />
      )}
    </div>
  );
}
