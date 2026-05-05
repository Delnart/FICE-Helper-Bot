'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/PageHeader';
import { Empty } from '../../../components/Empty';

interface SubjectDto {
  _id: string;
  name: string;
  type?: string;
  teachers: Array<{ userId?: string; fullName: string; roleInSubject: string }>;
  visibility: {
    homeworkVisible: boolean;
    queueVisible: boolean;
    linksVisible: boolean;
    teachersVisible: boolean;
  };
}

export default function SubjectsPage() {
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectDto[]>('/subjects'),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Предмети"
        action={
          <Link href="/subjects/new" className="btn-primary h-9 px-3 text-sm">
            + Додати
          </Link>
        }
      />
      {subjects.isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : subjects.data && subjects.data.length ? (
        <div className="space-y-2.5">
          {subjects.data.map((s) => (
            <Link
              key={s._id}
              href={`/subjects/${s._id}`}
              className="card flex items-center justify-between hover:bg-paper-100"
            >
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-ink-500 mt-0.5">
                  {s.teachers.length
                    ? s.teachers.map((t) => t.fullName).join(', ')
                    : 'Викладача не призначено'}
                </div>
              </div>
              <span className="text-ink-300">›</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="Поки немає предметів" hint="Староста може додати їх з розкладу" />
      )}
    </div>
  );
}
