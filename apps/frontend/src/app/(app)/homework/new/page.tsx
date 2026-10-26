'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { ErrorState } from '../../../../components/Empty';
import { Icon } from '../../../../components/icons';
import { SubjectTile } from '../../../../components/SubjectIcon';
import { Section } from '../../../../components/ui/Section';
import { Sheet } from '../../../../components/ui/Sheet';
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
  const [picking, setPicking] = useState(false);

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
        subtitle="Побачить уся група"
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
          {/* Native <select> renders badly in desktop Telegram — pick from a sheet instead. */}
          <button
            id="hw-subject"
            type="button"
            className="input flex items-center gap-3 pl-1.5 text-left"
            onClick={() => setPicking(true)}
            disabled={subjects.isLoading}
            aria-haspopup="dialog"
          >
            {subj ? (
              <SubjectTile name={subj.name} icon={subj.icon} size="sm" />
            ) : (
              <span className="subj subj-sm bg-surface-2 text-ink-3">
                <Icon name="book" strokeWidth={1.9} />
              </span>
            )}
            <span className={subj ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate text-ink-3'}>
              {subj
                ? subj.shortName || subj.name
                : subjects.isLoading
                  ? 'Завантаження…'
                  : 'Оберіть дисципліну'}
            </span>
            <Icon name="chevronDown" size={20} className="text-ink-3" />
          </button>
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

      <Sheet open={picking} onClose={() => setPicking(false)} title="Дисципліна">
        {subjects.data?.length ? (
          <div className="flex flex-col">
            {subjects.data.map((s, i) => {
              const on = s._id === subjectId;
              return (
                <Fragment key={s._id}>
                  {i > 0 ? <div className="divider" /> : null}
                  <button
                    type="button"
                    className="row-plain w-full text-left"
                    aria-pressed={on}
                    onClick={() => {
                      haptic('selection');
                      setSubjectId(s._id);
                      setPicking(false);
                    }}
                  >
                    <SubjectTile name={s.name} icon={s.icon} size="sm" tone={on ? 'accent' : 'soft'} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="h3 truncate">{s.shortName || s.name}</span>
                      {s.shortName && s.shortName !== s.name ? (
                        <span className="tiny faint truncate">{s.name}</span>
                      ) : null}
                    </span>
                    {on ? <Icon name="check" size={20} className="text-accent-text" /> : null}
                  </button>
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className="small muted">У групі ще немає дисциплін.</div>
        )}
      </Sheet>

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
          {create.isPending ? 'Зберігаємо…' : 'Додати завдання'}
        </button>
      </div>
    </div>
  );
}
