'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/api';

interface QueueShape {
  subjectId: string;
}

export default function LegacyQueueRedirectPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['queue-by-id', id],
    queryFn: () => api<QueueShape>(`/queues/${id}`),
  });

  useEffect(() => {
    if (q.data?.subjectId) {
      router.replace(`/subjects/${q.data.subjectId}/queue`);
    }
  }, [q.data, router]);

  return <div className="card text-sm text-ink-500">Відкриваємо чергу…</div>;
}
