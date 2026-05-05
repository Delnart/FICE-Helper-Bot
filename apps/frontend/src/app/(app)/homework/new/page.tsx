'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { haptic } from '../../../../lib/telegram';

interface SubjectRow {
  _id: string;
  name: string;
  shortName?: string;
}

interface CreateHwBody {
  subjectId: string;
  title: string;
  description?: string;
  deadline?: string;
  points?: number;
  teamSize?: number;
}

export default function NewHomeworkPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initialSubject = params.get('subjectId') ?? '';
  const [subjectId, setSubjectId] = useState(initialSubject);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('23:59');
  const [points, setPoints] = useState<number | ''>('');
  const [teamSize, setTeamSize] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectRow[]>('/subjects'),
  });

  useEffect(() => {
    if (!subjectId && subjects.data && subjects.data.length) {
      setSubjectId(subjects.data[0]._id);
    }
  }, [subjects.data, subjectId]);

  const create = useMutation({
    mutationFn: (body: CreateHwBody) =>
      api<{ _id: string }>('/homework', { method: 'POST', json: body }),
    onSuccess: (res) => {
      haptic('success');
      router.replace(`/homework/${res._id}`);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Не вдалося зберегти';
      setError(msg);
      haptic('error');
    },
  });

  function submit() {
    setError(null);
    if (!subjectId) {
      setError('Оберіть предмет');
      return;
    }
    if (title.trim().length < 1) {
      setError('Вкажіть назву');
      return;
    }
    let deadline: string | undefined;
    if (deadlineDate) {
      const local = dayjs(`${deadlineDate}T${deadlineTime || '23:59'}`);
      if (local.isValid()) deadline = local.toISOString();
    }
    create.mutate({
      subjectId,
      title: title.trim(),
      description: description.trim() || undefined,
      deadline,
      points: points === '' ? undefined : Number(points),
      teamSize: teamSize === '' ? undefined : Number(teamSize),
    });
  }

  const subj = subjects.data?.find((s) => s._id === subjectId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Нове домашнє завдання"
        subtitle={subj ? (subj.shortName ?? subj.name) : undefined}
      />

      <section className="card space-y-3">
        <div>
          <div className="label">Предмет</div>
          <select
            className="input"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={subjects.isLoading}
          >
            <option value="">— оберіть —</option>
            {(subjects.data ?? []).map((s) => (
              <option key={s._id} value={s._id}>
                {s.shortName ?? s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="label">Назва</div>
          <input
            className="input"
            placeholder="Наприклад: Лабораторна 3"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <div className="label">Опис (необовʼязково)</div>
          <textarea
            className="input min-h-[96px]"
            placeholder="Що саме треба зробити, де знайти умову, тощо"
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
            <div className="label">Балів (необовʼязково)</div>
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
            <div className="label">Команда (осіб)</div>
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
          disabled={create.isPending}
        >
          {create.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </div>
  );
}
