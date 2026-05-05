'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, getActiveGroup } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { haptic } from '../../../../lib/telegram';
import {
  CampusTeacherSuggestions,
  mergeTeacherRows,
} from '../../../../components/CampusTeacherSuggestions';

type TeacherRole = 'lecturer' | 'practice' | 'lab';

interface TeacherRow {
  fullName: string;
  telegramUsername?: string;
  role: TeacherRole;
}

interface LinkRow {
  label: string;
  url: string;
}

interface CreateSubjectBody {
  groupId: string;
  name: string;
  shortName?: string;
  teachers: TeacherRow[];
  links?: LinkRow[];
}

export default function NewSubjectPage() {
  const router = useRouter();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [teachers, setTeachers] = useState<TeacherRow[]>([
    { fullName: '', role: 'lecturer' },
  ]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGroupId(getActiveGroup());
  }, []);

  const create = useMutation({
    mutationFn: (body: CreateSubjectBody) =>
      api<{ _id: string }>('/subjects', { method: 'POST', json: body }),
    onSuccess: (res) => {
      haptic('success');
      router.replace(`/subjects/${res._id}`);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Не вдалося зберегти';
      setError(msg);
      haptic('error');
    },
  });

  function submit() {
    setError(null);
    if (!groupId) {
      setError('Активна група не обрана');
      return;
    }
    if (name.trim().length < 2) {
      setError('Назва предмета занадто коротка');
      return;
    }
    const cleanTeachers = teachers
      .map((t) => ({
        ...t,
        fullName: t.fullName.trim(),
        telegramUsername: t.telegramUsername?.trim() || undefined,
      }))
      .filter((t) => t.fullName.length >= 2);
    const cleanLinks = links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label && l.url);
    create.mutate({
      groupId,
      name: name.trim(),
      shortName: shortName.trim() || undefined,
      teachers: cleanTeachers,
      links: cleanLinks.length ? cleanLinks : undefined,
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Новий предмет" subtitle="Додайте назву, викладачів та корисні посилання" />

      <section className="card space-y-3">
        <div>
          <div className="label">Назва</div>
          <input
            className="input"
            placeholder="Наприклад: Дискретна математика"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <div className="label">Скорочення (необовʼязково)</div>
          <input
            className="input"
            placeholder="ДМ"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
          />
        </div>
      </section>

      <CampusTeacherSuggestions
        groupId={groupId}
        subjectName={name}
        existing={teachers}
        onAdd={(rows) => setTeachers((v) => mergeTeacherRows([...v, ...rows]))}
      />

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Викладачі</div>
          <button
            type="button"
            className="chip"
            onClick={() =>
              setTeachers((v) => [...v, { fullName: '', role: 'practice' }])
            }
          >
            Додати
          </button>
        </div>
        {teachers.map((t, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-paper-300 p-3">
            <input
              className="input"
              placeholder="ПІБ викладача"
              value={t.fullName}
              onChange={(e) =>
                setTeachers((v) => v.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)))
              }
            />
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Telegram (необовʼязково)"
                value={t.telegramUsername ?? ''}
                onChange={(e) =>
                  setTeachers((v) =>
                    v.map((x, j) => (j === i ? { ...x, telegramUsername: e.target.value } : x)),
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                className="input"
                value={t.role}
                onChange={(e) =>
                  setTeachers((v) =>
                    v.map((x, j) => (j === i ? { ...x, role: e.target.value as TeacherRole } : x)),
                  )
                }
              >
                <option value="lecturer">Лектор</option>
                <option value="practice">Практика</option>
                <option value="lab">Лабораторні</option>
              </select>
              {teachers.length > 1 ? (
                <button
                  type="button"
                  className="chip text-danger"
                  onClick={() => setTeachers((v) => v.filter((_, j) => j !== i))}
                >
                  Видалити
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Корисні посилання</div>
          <button
            type="button"
            className="chip"
            onClick={() => setLinks((v) => [...v, { label: '', url: '' }])}
          >
            Додати
          </button>
        </div>
        {links.length === 0 ? (
          <div className="text-sm text-ink-500">Необовʼязково. Можна додати google-диск, сторінку курсу тощо.</div>
        ) : null}
        {links.map((l, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-paper-300 p-3">
            <input
              className="input"
              placeholder="Назва посилання"
              value={l.label}
              onChange={(e) => setLinks((v) => v.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              className="input"
              placeholder="https://…"
              value={l.url}
              onChange={(e) => setLinks((v) => v.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            />
            <button
              type="button"
              className="chip text-danger"
              onClick={() => setLinks((v) => v.filter((_, j) => j !== i))}
            >
              Видалити
            </button>
          </div>
        ))}
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
