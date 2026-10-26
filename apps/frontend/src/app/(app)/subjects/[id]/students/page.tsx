'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../lib/api';
import { initials } from '../../../../../lib/name';
import { PageHeader } from '../../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../../components/Empty';
import { Icon } from '../../../../../components/icons';
import { pluralUk } from '../../../../../components/subjects/helpers';

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
  const count = students.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Список студентів" subtitle={displayName} />

      {students.isLoading ? (
        <Loading />
      ) : students.isError ? (
        <ErrorState
          error={students.error}
          onRetry={() => students.refetch()}
          title="Не вдалося завантажити список"
        />
      ) : !count ? (
        <Empty title="У цій групі немає студентів" icon="users" />
      ) : (
        <>
          <div>
            {students.data!.map((s) => {
              const name =
                s.fullName?.trim() ||
                [s.firstName, s.lastName].filter(Boolean).join(' ').trim() ||
                s.username ||
                String(s.telegramId);
              const username = s.username?.replace(/^@/, '');
              const tgUrl = username ? `https://t.me/${username}` : `tg://user?id=${s.telegramId}`;

              return (
                <a key={s._id} href={tgUrl} target="_blank" rel="noreferrer" className="row">
                  <span className="avatar">{initials(name)}</span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="h3 truncate">{name}</span>
                    {username ? <span className="tiny faint truncate">@{username}</span> : null}
                  </div>
                  <Icon name="arrowUpRight" size={18} className="chev" />
                </a>
              );
            })}
          </div>
          <div className="tiny faint pb-2 text-center">
            <span className="num">{count}</span>{' '}
            {pluralUk(count, ['студент', 'студенти', 'студентів'])}
          </div>
        </>
      )}
    </div>
  );
}
