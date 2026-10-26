'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { ErrorState } from '../../../../components/Empty';
import { SubjectTile } from '../../../../components/SubjectIcon';
import { Section } from '../../../../components/ui/Section';
import { haptic } from '../../../../lib/telegram';

interface SubjectRow {
  _id: string;
  name: string;
  shortName?: string;
  icon?: string;
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
      setError('Оберіть дисципліну');
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Нове завдання"
        subtitle={subj ? (subj.shortName ?? subj.name) : undefined}
      />

      {subjects.isError ? (
        <ErrorState
          error={subjects.error}
          onRetry={() => subjects.refetch()}
          title="Не вдалося завантажити дисципліни"
        />
      ) : null}

      <section className="card-flat flex flex-col gap-3.5">
        <div>
          <label className="label" htmlFor="hw-subject">
            Дисципліна
          </label>
          <div className="flex items-center gap-2.5">
            {subj ? <SubjectTile name={subj.name} icon={subj.icon} /> : null}
            <select
              id="hw-subject"
              className="input min-w-0 flex-1"
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
        </div>

        <div>
          <label className="label" htmlFor="hw-title">
            Назва
          </label>
          <input
            id="hw-title"
            className="input"
            placeholder="Наприклад: Лабораторна 3"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="hw-desc">
            Опис (необовʼязково)
          </label>
          <textarea
            id="hw-desc"
            className="textarea"
            placeholder="Що саме треба зробити, де знайти умову, тощо"
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
              Балів (необовʼязково)
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
          disabled={create.isPending}
        >
          {create.isPending ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </div>
  );
}
