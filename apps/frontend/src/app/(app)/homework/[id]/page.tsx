'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { haptic } from '../../../../lib/telegram';

interface HwDetail {
  _id: string;
  title: string;
  description?: string;
  deadline: string;
  points?: number;
  teamSize: number;
  subjectName?: string;
  subjectId: string;
  attachments?: Array<{ label: string; url: string }>;
  done?: boolean;
  canManage?: boolean;
  isTeacher?: boolean;
}

export default function HomeworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['hw', id],
    queryFn: () => api<HwDetail>(`/homework/${id}`),
  });

  const invalidateHwLists = () => {
    qc.invalidateQueries({ queryKey: ['hw', id] });
    qc.invalidateQueries({ queryKey: ['hw-pending-count'] });
    qc.invalidateQueries({ queryKey: ['hw-all'] });
    qc.invalidateQueries({ queryKey: ['subject-hw'] });
  };

  const toggle = useMutation({
    mutationFn: (done: boolean) =>
      api(`/homework/${id}/completion`, { method: 'PATCH', json: { done } }),
    onSuccess: () => {
      haptic('success');
      invalidateHwLists();
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/homework/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic('success');
      invalidateHwLists();
      if (data?.subjectId) {
        router.replace(`/subjects/${data.subjectId}/homework` as Route);
      } else {
        router.replace('/homework');
      }
    },
    onError: () => haptic('error'),
  });

  if (!data) return <div className="card text-sm text-ink-500">Завантаження…</div>;
  const due = dayjs(data.deadline);

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.title}
        subtitle={data.subjectName}
        action={
          data.canManage ? (
            <Link
              href={`/homework/${id}/edit` as Route}
              className="btn-secondary h-9 px-3 text-sm"
            >
              Редагувати
            </Link>
          ) : undefined
        }
      />
      <section className="card space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="chip">до {due.format('DD.MM.YYYY HH:mm')}</span>
          {data.points ? <span className="chip">{data.points} балів</span> : null}
          {data.teamSize > 1 ? <span className="chip">Команда до {data.teamSize}</span> : null}
        </div>
        {data.description ? (
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{data.description}</div>
        ) : null}
        {data.attachments?.length ? (
          <div className="space-y-1.5">
            {data.attachments.map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noreferrer" className="chip bg-accent-soft text-accent">
                {a.label} ↗
              </a>
            ))}
          </div>
        ) : null}
      </section>
      {/* Only students can mark homework as completed. */}
      {!data.canManage && !data.isTeacher ? (
        <button
          className={data.done ? 'btn-secondary w-full' : 'btn-primary w-full'}
          onClick={() => toggle.mutate(!data.done)}
          disabled={toggle.isPending}
        >
          {data.done ? 'Повернути в «очікує»' : 'Позначити виконаним'}
        </button>
      ) : null}

      {data.canManage ? (
        <button
          type="button"
          className="btn-secondary w-full text-danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm('Видалити це домашнє завдання? Дію неможливо скасувати.')) {
              remove.mutate();
            }
          }}
        >
          {remove.isPending ? 'Видаляємо…' : 'Видалити завдання'}
        </button>
      ) : null}
    </div>
  );
}
