'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubjectLink } from '@fice/shared';
import { api, getActiveGroup } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { haptic } from '../../../../../lib/telegram';
import {
  CampusTeacherSuggestions,
  mergeTeacherRows,
} from '../../../../../components/CampusTeacherSuggestions';

type TeacherRole = 'lecturer' | 'practice' | 'lab';

interface TeacherRow {
  fullName: string;
  telegramUsername?: string;
  role: TeacherRole;
}

type LinkRow = SubjectLink;

interface SubjectDetail {
  _id: string;
  name: string;
  shortName?: string;
  teachers: Array<TeacherRow & { roleInSubject?: string }>;
  links: LinkRow[];
  visibility: {
    homeworkVisible: boolean;
    queueVisible: boolean;
    linksVisible: boolean;
    teachersVisible: boolean;
  };
  canManage: boolean;
}

interface UpdateBody {
  name?: string;
  shortName?: string;
  teachers?: TeacherRow[];
  links?: LinkRow[];
  settings?: {
    hideHomework?: boolean;
    hideQueue?: boolean;
    hideLinks?: boolean;
    hideTeachers?: boolean;
  };
}

export default function EditSubjectPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const subject = useQuery({
    queryKey: ['subject', id],
    queryFn: () => api<SubjectDetail>(`/subjects/${id}`),
  });

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [hideHomework, setHideHomework] = useState(false);
  const [hideQueue, setHideQueue] = useState(false);
  const [hideLinks, setHideLinks] = useState(false);
  const [hideTeachers, setHideTeachers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!subject.data || hydrated) return;
    const s = subject.data;
    setName(s.name);
    setShortName(s.shortName ?? '');
    setTeachers(
      (s.teachers ?? []).map((t) => ({
        fullName: t.fullName,
        telegramUsername: t.telegramUsername,
        role: ((t.roleInSubject ?? t.role) as TeacherRole) || 'lecturer',
      })),
    );
    setLinks(
      (s.links ?? []).map((l) => ({
        label: l.label,
        url: l.url,
        teacherUserId: l.teacherUserId,
        showInLessonReminder: l.showInLessonReminder ?? false,
        lessonReminderType: l.lessonReminderType,
      })),
    );
    setHideHomework(!s.visibility.homeworkVisible);
    setHideQueue(!s.visibility.queueVisible);
    setHideLinks(!s.visibility.linksVisible);
    setHideTeachers(!s.visibility.teachersVisible);
    setHydrated(true);
  }, [subject.data, hydrated]);

  const update = useMutation({
    mutationFn: (body: UpdateBody) =>
      api<{ _id: string }>(`/subjects/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      haptic('success');
      void qc.invalidateQueries({ queryKey: ['subject', id] });
      void qc.invalidateQueries({ queryKey: ['subjects'] });
      router.replace(`/subjects/${id}`);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Не вдалося зберегти';
      setError(msg);
      haptic('error');
    },
  });

  const remove = useMutation({
    mutationFn: () => api<{ ok: true }>(`/subjects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      haptic('success');
      router.replace('/');
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Не вдалося видалити');
      haptic('error');
    },
  });

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Назва занадто коротка');
      return;
    }
    const cleanTeachers = teachers
      .map((t) => ({
        fullName: t.fullName.trim(),
        telegramUsername: t.telegramUsername?.trim() || undefined,
        role: t.role,
      }))
      .filter((t) => t.fullName.length >= 2);
    const cleanLinks = links
      .map((l) => ({
        ...l,
        label: l.label.trim(),
        url: l.url.trim(),
        showInLessonReminder: Boolean(l.showInLessonReminder),
        lessonReminderType: l.showInLessonReminder ? l.lessonReminderType ?? 'lecture' : undefined,
      }))
      .filter((l) => l.label && l.url);
    update.mutate({
      name: name.trim(),
      shortName: shortName.trim() || undefined,
      teachers: cleanTeachers,
      links: cleanLinks,
      settings: { hideHomework, hideQueue, hideLinks, hideTeachers },
    });
  }

  if (subject.isLoading) {
    return <div className="card text-sm text-ink-500">Завантаження…</div>;
  }
  if (subject.data && !subject.data.canManage) {
    return (
      <div className="card text-sm text-ink-500">
        Лише староста або заступник можуть редагувати предмет.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Редагування" subtitle={subject.data?.name} />

      <section className="card space-y-3">
        <div>
          <div className="label">Назва</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div className="label">Скорочення</div>
          <input
            className="input"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
          />
        </div>
      </section>

      <CampusTeacherSuggestions
        groupId={getActiveGroup()}
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
            onClick={() => setTeachers((v) => [...v, { fullName: '', role: 'practice' }])}
          >
            Додати
          </button>
        </div>
        {teachers.length === 0 ? (
          <div className="text-sm text-ink-500">Поки немає викладачів.</div>
        ) : null}
        {teachers.map((t, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-paper-300 p-3">
            <input
              className="input"
              placeholder="ПІБ викладача"
              value={t.fullName}
              onChange={(e) =>
                setTeachers((v) =>
                  v.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)),
                )
              }
            />
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Telegram"
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
                    v.map((x, j) =>
                      j === i ? { ...x, role: e.target.value as TeacherRole } : x,
                    ),
                  )
                }
              >
                <option value="lecturer">Лектор</option>
                <option value="practice">Практика</option>
                <option value="lab">Лабораторні</option>
              </select>
              <button
                type="button"
                className="chip text-danger"
                onClick={() => setTeachers((v) => v.filter((_, j) => j !== i))}
              >
                Видалити
              </button>
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
          <div className="text-sm text-ink-500">Поки немає посилань.</div>
        ) : null}
        {links.map((l, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-paper-300 p-3">
            <input
              className="input"
              placeholder="Назва"
              value={l.label}
              onChange={(e) =>
                setLinks((v) => v.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <input
              className="input"
              placeholder="https://…"
              value={l.url}
              onChange={(e) =>
                setLinks((v) => v.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
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

      <section className="card space-y-3">
        <div className="font-medium">Видимість розділів</div>
        <ToggleRow
          title="Домашка"
          checked={!hideHomework}
          onChange={(v) => setHideHomework(!v)}
        />
        <ToggleRow title="Черга" checked={!hideQueue} onChange={(v) => setHideQueue(!v)} />
        <ToggleRow title="Посилання" checked={!hideLinks} onChange={(v) => setHideLinks(!v)} />
        <ToggleRow
          title="Викладачі"
          checked={!hideTeachers}
          onChange={(v) => setHideTeachers(!v)}
        />
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

      <button
        type="button"
        className="btn-secondary w-full text-danger"
        disabled={remove.isPending}
        onClick={() => {
          if (window.confirm('Видалити предмет? Цю дію не можна скасувати.')) {
            remove.mutate();
          }
        }}
      >
        {remove.isPending ? 'Видалення…' : 'Видалити предмет'}
      </button>
    </div>
  );
}

function ToggleRow({
  title,
  checked,
  onChange,
}: {
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm">{title}</div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={
          'relative h-7 w-12 rounded-full transition-colors ' +
          (checked ? 'bg-ink-900' : 'bg-paper-300')
        }
      >
        <span
          className={
            'absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-paper-50 shadow transition-transform ' +
            (checked ? 'translate-x-5' : '')
          }
        />
      </button>
    </div>
  );
}
