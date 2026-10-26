'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { api } from '../../../../lib/api';
import { cn } from '../../../../lib/cn';
import { haptic } from '../../../../lib/telegram';
import { PageHeader } from '../../../../components/PageHeader';
import { ErrorState, Loading } from '../../../../components/Empty';
import { Icon } from '../../../../components/icons';
import { SubjectTile } from '../../../../components/SubjectIcon';
import { pluralUk } from '../../../../components/subjects/helpers';
import { Section } from '../../../../components/ui/Section';

interface HwDetail {
  _id: string;
  title: string;
  description?: string;
  deadline?: string;
  points?: number;
  teamSize: number;
  subjectName?: string;
  subjectId: string;
  attachments?: Array<{ label: string; url: string }>;
  done?: boolean;
  canManage?: boolean;
  isTeacher?: boolean;
}

interface SubjectRow {
  _id: string;
  name: string;
  icon?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function HomeworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['hw', id],
    queryFn: () => api<HwDetail>(`/homework/${id}`),
  });
  // Only for the discipline's custom icon; the tile falls back to the name-based one.
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectRow[]>('/subjects'),
  });

  const invalidateHwLists = () => {
    qc.invalidateQueries({ queryKey: ['hw-pending-count'] });
    qc.invalidateQueries({ queryKey: ['hw-all'] });
    qc.invalidateQueries({ queryKey: ['subject-hw'] });
  };

  const toggle = useMutation({
    mutationFn: (done: boolean) =>
      api(`/homework/${id}/completion`, { method: 'PATCH', json: { done } }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['hw', id] });
      invalidateHwLists();
    },
    onError: () => haptic('error'),
  });

  const remove = useMutation({
    mutationFn: () => api(`/homework/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic('success');
      // Mark stale without refetching: the deleted item would 404 and flash an error before the redirect.
      qc.invalidateQueries({ queryKey: ['hw', id], refetchType: 'none' });
      invalidateHwLists();
      if (data?.subjectId) {
        router.replace(`/subjects/${data.subjectId}/homework` as Route);
      } else {
        router.replace('/homework');
      }
    },
    onError: () => haptic('error'),
  });

  if (!data && !isError) return <Loading />;
  // Error wins over cached data: a 403 (other group's homework) must not show stale content.
  if (isError || !data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Завдання" />
        <ErrorState error={error} onRetry={() => refetch()} title="Не вдалося завантажити завдання" />
      </div>
    );
  }

  const due = data.deadline ? dayjs(data.deadline).locale('uk') : null;
  const overdue = !!due && !data.done && due.isBefore(dayjs());
  const soon = !!due && !data.done && !overdue && due.diff(dayjs(), 'hour') < 48;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={data.title}
        action={
          data.canManage ? (
            <Link
              href={`/homework/${id}/edit` as Route}
              className="icon-btn"
              aria-label="Редагувати завдання"
            >
              <Icon name="edit" />
            </Link>
          ) : undefined
        }
        chips={
          <>
            {data.done ? (
              <span className="chip chip-ok">
                <Icon name="check" size={12} strokeWidth={3} />
                виконано
              </span>
            ) : null}
            <span className={cn('chip', overdue && 'chip-bad', soon && 'chip-warn')}>
              {due
                ? `${overdue ? 'прострочено · ' : 'до '}${due.format(due.isSame(dayjs(), 'year') ? 'dd, D MMM[.], HH:mm' : 'D MMM[.] YYYY, HH:mm')}`
                : 'без дедлайну'}
            </span>
            {data.points ? (
              <span className="chip">
                {data.points} {pluralUk(data.points, ['бал', 'бали', 'балів'])}
              </span>
            ) : null}
            {data.teamSize > 1 ? (
              <span className="chip">
                <Icon name="users" size={12} strokeWidth={2.2} />
                команда до {data.teamSize}
              </span>
            ) : null}
          </>
        }
      />

      <Link
        href={`/subjects/${data.subjectId}` as Route}
        className="card-flat flex items-center gap-3 px-3.5 py-3"
      >
        <SubjectTile
          name={data.subjectName ?? ''}
          icon={subjects.data?.find((s) => s._id === data.subjectId)?.icon}
          size="sm"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="tiny faint">Дисципліна</span>
          <span className="h3 truncate">{data.subjectName || 'Без назви'}</span>
        </div>
        <Icon name="chevronRight" size={18} className="text-ink-3" />
      </Link>

      {data.description ? (
        <Section title="Опис">
          <div className="card-flat whitespace-pre-wrap break-words text-[15px] leading-relaxed">
            {data.description}
          </div>
        </Section>
      ) : null}

      {data.attachments?.length ? (
        <Section title="Матеріали">
          <div className="card-flat flex flex-col px-3.5 py-1">
            {data.attachments.map((a, i) => (
              <div key={i}>
                {i > 0 ? <div className="divider" /> : null}
                <a href={a.url} target="_blank" rel="noreferrer" className="row-plain">
                  <span className="subj subj-sm">
                    <Icon name="link" strokeWidth={1.9} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="h3 truncate">{a.label}</span>
                    <span className="tiny faint truncate">{hostOf(a.url)}</span>
                  </span>
                  <Icon name="arrowUpRight" size={18} className="text-ink-3" />
                </a>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Teachers don't have homework themselves, so they can't complete it. */}
      {!data.isTeacher ? (
        <button
          type="button"
          className={data.done ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block'}
          onClick={() => toggle.mutate(!data.done)}
          disabled={toggle.isPending}
        >
          <Icon name={data.done ? 'refresh' : 'check'} size={18} />
          {data.done ? 'Повернути в «очікує»' : 'Позначити виконаним'}
        </button>
      ) : null}
      {toggle.isError ? (
        <div role="alert" className="small text-bad">
          {toggle.error.message}
        </div>
      ) : null}

      {data.canManage ? (
        <button
          type="button"
          className="btn btn-ghost btn-md btn-block text-bad"
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
      {remove.isError ? (
        <div role="alert" className="small text-bad">
          {remove.error.message}
        </div>
      ) : null}
    </div>
  );
}
