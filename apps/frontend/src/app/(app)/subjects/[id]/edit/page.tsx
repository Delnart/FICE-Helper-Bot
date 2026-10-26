'use client';

import { useParams, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubjectLink } from '@fice/shared';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { ErrorState, Loading } from '../../../../../components/Empty';
import { Section } from '../../../../../components/ui/Section';
import { Toggle } from '../../../../../components/ui/Toggle';
import { haptic } from '../../../../../lib/telegram';
import { useActiveGroup, useMe } from '../../../../../hooks/useMe';
import type { TeacherRoleId, TeacherRow } from '../../../../../components/CampusTeacherSuggestions';
import {
  cleanLink,
  LinksEditor,
  SubjectBasicsCard,
  TeachersEditor,
} from '../../../../../components/subject-edit/parts';

interface SubjectDetail {
  _id: string;
  groupId?: string;
  name: string;
  shortName?: string;
  icon?: string;
  teachers: Array<TeacherRow & { roleInSubject?: string }>;
  links: SubjectLink[];
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
  icon?: string;
  teachers?: TeacherRow[];
  links?: SubjectLink[];
  settings?: {
    hideHomework?: boolean;
    hideQueue?: boolean;
    hideLinks?: boolean;
    hideTeachers?: boolean;
  };
}

interface Form {
  name: string;
  shortName: string;
  /** '' = picked automatically from the name. */
  icon: string;
  teachers: TeacherRow[];
  links: SubjectLink[];
  hideHomework: boolean;
  hideQueue: boolean;
  hideLinks: boolean;
  hideTeachers: boolean;
}

/** Switch ON = students see the section (i.e. not hidden). */
const VISIBILITY = [
  ['hideQueue', 'Черга на здачу'],
  ['hideHomework', 'Завдання'],
  ['hideLinks', 'Посилання'],
  ['hideTeachers', 'Контакти викладачів'],
] as const;

function toForm(s: SubjectDetail): Form {
  return {
    name: s.name,
    shortName: s.shortName ?? '',
    icon: s.icon ?? '',
    teachers: (s.teachers ?? []).map((t) => ({
      teacherUserId: t.teacherUserId,
      fullName: t.fullName,
      telegramUsername: t.telegramUsername,
      role: ((t.roleInSubject ?? t.role) as TeacherRoleId) || 'lecturer',
    })),
    links: (s.links ?? []).map((l) => ({
      label: l.label,
      url: l.url,
      teacherUserId: l.teacherUserId,
      showInLessonReminder: l.showInLessonReminder ?? false,
      lessonReminderType: l.lessonReminderType,
    })),
    hideHomework: !s.visibility.homeworkVisible,
    hideQueue: !s.visibility.queueVisible,
    hideLinks: !s.visibility.linksVisible,
    hideTeachers: !s.visibility.teachersVisible,
  };
}

export default function EditSubjectPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const activeGroup = useActiveGroup();
  const subject = useQuery({
    queryKey: ['subject', id],
    queryFn: () => api<SubjectDetail>(`/subjects/${id}`),
  });

  const [form, setForm] = useState<Form | null>(null);
  const [initial, setInitial] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Hydrate once from the server copy; the snapshot drives the "не збережено" chip.
  useEffect(() => {
    if (!subject.data || form) return;
    const f = toForm(subject.data);
    setForm(f);
    setInitial(JSON.stringify(f));
  }, [subject.data, form]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

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
      // Drop this subject from every cache it appears in, otherwise the
      // home page / subject lists still show it until manual refresh.
      qc.removeQueries({ queryKey: ['subject', id] });
      void qc.invalidateQueries({ queryKey: ['subjects'] });
      void qc.invalidateQueries({ queryKey: ['subject-hw'] });
      void qc.invalidateQueries({ queryKey: ['hw-pending-count'] });
      router.replace('/');
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Не вдалося видалити');
      haptic('error');
    },
  });

  function submit() {
    if (!form) return;
    setError(null);
    if (form.name.trim().length < 2) {
      setError('Назва занадто коротка');
      return;
    }
    const cleanTeachers = form.teachers
      .map((t) => ({
        teacherUserId: t.teacherUserId,
        fullName: t.fullName.trim(),
        telegramUsername: t.telegramUsername?.trim() || undefined,
        role: t.role,
      }))
      .filter((t) => t.fullName.length >= 2);
    const cleanLinks = form.links.map(cleanLink).filter((l) => l.label && l.url);
    update.mutate({
      name: form.name.trim(),
      shortName: form.shortName.trim(),
      // '' clears a manual pick on the backend → back to the automatic icon.
      icon: form.icon,
      teachers: cleanTeachers,
      links: cleanLinks,
      settings: {
        hideHomework: form.hideHomework,
        hideQueue: form.hideQueue,
        hideLinks: form.hideLinks,
        hideTeachers: form.hideTeachers,
      },
    });
  }

  const s = subject.data;
  const groupName = me.data?.memberships.find((m) => m.groupId === s?.groupId)?.groupName;
  const dirty = !!form && JSON.stringify(form) !== initial;

  let body: ReactNode;
  if (subject.isLoading) body = <Loading />;
  else if (!s) {
    body = (
      <ErrorState
        title="Не вдалося завантажити дисципліну"
        error={subject.error}
        onRetry={() => subject.refetch()}
      />
    );
  } else if (!s.canManage) {
    body = (
      <div className="card-flat small muted">
        Лише староста або заступник можуть редагувати дисципліну.
      </div>
    );
  } else if (!form) body = <Loading />;
  else {
    body = (
      <>
        <SubjectBasicsCard
          name={form.name}
          shortName={form.shortName}
          icon={form.icon}
          onName={(v) => set('name', v)}
          onShortName={(v) => set('shortName', v)}
          onIcon={(v) => set('icon', v)}
        />

        <TeachersEditor
          groupId={s.groupId ?? activeGroup}
          subjectName={form.name}
          teachers={form.teachers}
          onChange={(v) => set('teachers', v)}
        />

        <Section title="Корисні посилання">
          <LinksEditor links={form.links} onChange={(v) => set('links', v)} />
        </Section>

        <Section title="Що бачать студенти">
          <div className="card-flat flex flex-col px-3.5 py-1">
            {VISIBILITY.map(([key, label], i) => (
              <Fragment key={key}>
                {i > 0 ? <div className="divider" /> : null}
                <div className="row-plain justify-between">
                  <span className="h3">{label}</span>
                  <Toggle label={label} checked={!form[key]} onChange={(v) => set(key, !v)} />
                </div>
              </Fragment>
            ))}
          </div>
        </Section>

        {error ? <div className="card-flat small text-bad">{error}</div> : null}

        <button
          type="button"
          className="btn btn-ghost btn-block h-11 text-bad"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm('Видалити дисципліну? Цю дію не можна скасувати.')) {
              remove.mutate();
            }
          }}
        >
          {remove.isPending ? 'Видалення…' : 'Видалити дисципліну'}
        </button>

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
            {update.isPending ? 'Зберігаємо…' : 'Зберегти зміни'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Редагування"
        subtitle={[s?.name, groupName].filter(Boolean).join(' · ') || undefined}
        action={dirty ? <span className="chip chip-warn mt-1">не збережено</span> : undefined}
      />
      {body}
    </div>
  );
}
