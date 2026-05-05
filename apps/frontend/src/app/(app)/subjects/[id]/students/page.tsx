'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';

interface Student {
  _id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  username?: string;
  telegramId: number;
}

interface SubjectDetail {
  _id: string;
  name: string;
  shortName?: string;
}

export default function SubjectStudentsPage() {
  const { id } = useParams<{ id: string }>();

  const subject = useQuery({
    queryKey: ['subject', id],
    queryFn: () => api<SubjectDetail>(`/subjects/${id}`),
  });

  const students = useQuery({
    queryKey: ['subject-students', id],
    queryFn: () => api<Student[]>(`/subjects/${id}/students`),
  });

  const displayName = subject.data?.shortName ?? subject.data?.name ?? '…';

  return (
    <div className="space-y-4">
      <PageHeader title="Список студентів" subtitle={displayName} />

      {students.isLoading ? (
        <div className="card text-sm text-ink-500">Завантаження…</div>
      ) : students.isError ? (
        <div className="card text-sm text-danger">Не вдалося завантажити список.</div>
      ) : !students.data?.length ? (
        <div className="card text-sm text-ink-500">У цій групі немає студентів.</div>
      ) : (
        <div className="space-y-1.5">
          {students.data.map((s) => {
            const name =
              s.fullName?.trim() ||
              [s.firstName, s.lastName].filter(Boolean).join(' ').trim() ||
              s.username ||
              String(s.telegramId);
            const tgUrl = s.username
              ? `https://t.me/${s.username.replace(/^@/, '')}`
              : `tg://user?id=${s.telegramId}`;

            return (
              <a
                key={s._id}
                href={tgUrl}
                target="_blank"
                rel="noreferrer"
                className="card flex items-center justify-between gap-3 hover:bg-paper-100 active:scale-[0.99] transition-transform no-underline"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-9 w-9 rounded-full bg-accent-soft text-accent flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {initials(name)}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{name}</div>
                    {s.username ? (
                      <div className="text-xs text-ink-500 truncate">@{s.username.replace(/^@/, '')}</div>
                    ) : null}
                  </div>
                </div>
                <span className="text-ink-300 flex-shrink-0 text-lg">↗</span>
              </a>
            );
          })}
        </div>
      )}

      <div className="text-xs text-ink-400 text-center pb-2">
        {students.data?.length ?? 0} студентів
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const p = name.toUpperCase();
  return p.length <= 2 ? p : p.slice(0, 2);
}
