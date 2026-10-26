'use client';

import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { ErrorState, Loading } from '../../../../../components/Empty';
import { Section } from '../../../../../components/ui/Section';
import { haptic } from '../../../../../lib/telegram';

interface HwDetail {
  _id: string;
  title: string;
  description?: string;
  deadline?: string;
  points?: number;
  teamSize: number;
  subjectId: string;
  subjectName?: string;
  done?: boolean;
  canManage?: boolean;
}

interface UpdateHwBody {
  title?: string;
  description?: string;
  deadline?: string;
  points?: number;
  teamSize?: number;
}

export default function EditHomeworkPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isError, error: loadError, refetch } = useQuery({
    queryKey: ['hw', id],
    queryFn: () => api<HwDetail>(`/homework/${id}`),
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('23:59');
  const [points, setPoints] = useState<number | ''>('');
  const [teamSize, setTeamSize] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form once per id — a background refetch (e.g. window focus)
  // must not overwrite unsaved edits.
  const hydratedId = useRef<string | null>(null);
  useEffect(() => {
    if (!data || hydratedId.current === id) return;
    hydratedId.current = id;
    setTitle(data.title ?? '');
    setDescription(data.description ?? '');
    if (data.deadline) {
      const d = dayjs(data.deadline);
      if (d.isValid()) {
        setDeadlineDate(d.format('YYYY-MM-DD'));
        setDeadlineTime(d.format('HH:mm'));
      }
    }
    setPoints(data.points ?? '');
    setTeamSize(typeof data.teamSize === 'number' ? data.teamSize : '');
  }, [data, id]);

  const invalidateHwLists = () => {
    qc.invalidateQueries({ queryKey: ['hw', id] });
    qc.invalidateQueries({ queryKey: ['hw-pending-count'] });
    qc.invalidateQueries({ queryKey: ['hw-all'] });
    qc.invalidateQueries({ queryKey: ['subject-hw'] });
  };

  const update = useMutation({
    mutationFn: (body: UpdateHwBody) =>
      api(`/homework/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      haptic('success');
      invalidateHwLists();
      router.replace(`/homework/${id}` as Route);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
      haptic('error');
    },
  });

  if (!data && !isError) return <Loading />;
  if (!data || !data.canManage) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Редагування" />
        {data ? (
          <div className="card-flat small text-bad">
            Лише староста, заступник чи викладач може редагувати ДЗ.
          </div>
        ) : (
          <ErrorState error={loadError} onRetry={() => refetch()} title="Не вдалося завантажити завдання" />
        )}
      </div>
    );
  }

  function submit() {
    setError(null);
    if (title.trim().length < 1) {
      setError('Вкажіть назву');
      return;
    }
    let deadline: string | undefined;
    if (deadlineDate) {
      const local = dayjs(`${deadlineDate}T${deadlineTime || '23:59'}`);
      if (local.isValid()) deadline = local.toISOString();
    }
    update.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      deadline,
      points: points === '' ? undefined : Number(points),
      teamSize: teamSize === '' ? undefined : Number(teamSize),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Редагування" subtitle={data.subjectName} />

      <section className="card-flat flex flex-col gap-3.5">
        <div>
          <label className="label" htmlFor="hw-title">
            Назва
          </label>
          <input
            id="hw-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="hw-desc">
            Опис
          </label>
          <textarea
            id="hw-desc"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </section>

      <Section title="Дедлайн">
        <div className="card-flat">
          <div className="flex gap-2.5">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="hw-date">
                Дата
              </label>
              <input
                id="hw-date"
                type="date"
                className="input num"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
              />
            </div>
            <div className="w-28">
              <label className="label" htmlFor="hw-time">
                Час
              </label>
              <input
                id="hw-time"
                type="time"
                className="input num"
                value={deadlineTime}
                onChange={(e) => setDeadlineTime(e.target.value)}
                disabled={!deadlineDate}
              />
            </div>
          </div>
          {!deadlineDate ? <div className="hint">Без дати — без дедлайну</div> : null}
        </div>
      </Section>

      <Section title="Оцінювання">
        <div className="card-flat flex gap-2.5">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="hw-points">
              Балів
            </label>
            <input
              id="hw-points"
              type="number"
              inputMode="numeric"
              className="input num"
              min={0}
              max={100}
              value={points}
              onChange={(e) => {
                const v = e.target.value;
                setPoints(v === '' ? '' : Math.max(0, Math.min(100, Number(v))));
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="hw-team">
              Команда (осіб)
            </label>
            <input
              id="hw-team"
              type="number"
              inputMode="numeric"
              className="input num"
              min={0}
              max={50}
              value={teamSize}
              onChange={(e) => {
                const v = e.target.value;
                setTeamSize(v === '' ? '' : Math.max(0, Math.min(50, Number(v))));
              }}
            />
          </div>
        </div>
      </Section>

      {error ? <div className="card-flat small text-bad">{error}</div> : null}

      <div className="action-bar">
        <button type="button" className="btn btn-secondary flex-1" onClick={() => router.back()}>
          Скасувати
        </button>
        <button
          type="button"
          className="btn btn-primary flex-[2]"
          onClick={submit}
          disabled={update.isPending}
        >
          {update.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </div>
  );
}
