'use client';

import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { haptic } from '../../../../../lib/telegram';

interface HwDetail {
  _id: string;
  title: string;
  description?: string;
  deadline: string;
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
  const { data } = useQuery({
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

  // Hydrate form from loaded data
  useEffect(() => {
    if (!data) return;
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
  }, [data]);

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

  if (!data) return <div className="card text-sm text-ink-500">Завантаження…</div>;
  if (!data.canManage) {
    return (
      <div className="card text-sm text-danger">
        Лише староста, заступник чи викладач може редагувати ДЗ.
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
    <div className="space-y-4">
      <PageHeader title="Редагувати ДЗ" subtitle={data.subjectName} />

      <section className="card space-y-3">
        <div>
          <div className="label">Назва</div>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <div className="label">Опис</div>
          <textarea
            className="input min-h-[96px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <div className="label">Дедлайн</div>
          <div className="flex gap-2">
            <input
              type="date"
              className="input flex-1"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
            />
            <input
              type="time"
              className="input w-28"
              value={deadlineTime}
              onChange={(e) => setDeadlineTime(e.target.value)}
              disabled={!deadlineDate}
            />
          </div>
          {!deadlineDate ? (
            <div className="text-xs text-ink-500 mt-1">Без дати — без дедлайну</div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="label">Балів</div>
            <input
              type="number"
              className="input"
              min={0}
              max={100}
              value={points}
              onChange={(e) => {
                const v = e.target.value;
                setPoints(v === '' ? '' : Math.max(0, Math.min(100, Number(v))));
              }}
            />
          </div>
          <div className="flex-1">
            <div className="label">Команда</div>
            <input
              type="number"
              className="input"
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
      </section>

      {error ? <div className="card text-sm text-danger">{error}</div> : null}

      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={() => router.back()}>
          Скасувати
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={submit}
          disabled={update.isPending}
        >
          {update.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </div>
  );
}
