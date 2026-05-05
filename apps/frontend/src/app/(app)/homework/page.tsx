'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Empty } from '../../../components/Empty';

interface HwRow {
  _id: string;
  title: string;
  subjectName?: string;
  deadline: string;
  done?: boolean;
  points?: number;
}

export default function HomeworkListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['hw-all'],
    queryFn: () => api<HwRow[]>('/homework'),
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Домашні завдання"
        action={
          <Link href="/homework/new" className="btn-primary h-9 px-3 text-sm">
            + ДЗ
          </Link>
        }
      />
      {isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : data && data.length ? (
        <div className="space-y-2">
          {data.map((h) => (
            <Link key={h._id} href={`/homework/${h._id}`} className="card flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">{h.title}</div>
                <div className="text-sm text-ink-500 truncate">
                  {h.subjectName ? `${h.subjectName} · ` : ''}до {dayjs(h.deadline).format('DD.MM HH:mm')}
                </div>
              </div>
              {h.done ? (
                <span className="chip bg-success/10 text-success">Виконано</span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="Усе виконано" />
      )}
    </div>
  );
}
