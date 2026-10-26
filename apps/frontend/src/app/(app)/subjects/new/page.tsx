'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { SubjectLink } from '@fice/shared';
import { api } from '../../../../lib/api';
import { useActiveGroup } from '../../../../hooks/useMe';
import { PageHeader } from '../../../../components/PageHeader';
import { Section } from '../../../../components/ui/Section';
import { haptic } from '../../../../lib/telegram';
import type { TeacherRow } from '../../../../components/CampusTeacherSuggestions';
import {
  cleanLink,
  LinksEditor,
  SubjectBasicsCard,
  TeachersEditor,
} from '../../../../components/subject-edit/parts';

interface CreateSubjectBody {
  groupId: string;
  name: string;
  shortName?: string;
  icon?: string;
  teachers: TeacherRow[];
  links?: SubjectLink[];
}

export default function NewSubjectPage() {
  const router = useRouter();
  const groupId = useActiveGroup();
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [icon, setIcon] = useState('');
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [links, setLinks] = useState<SubjectLink[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      setError('Назва дисципліни занадто коротка');
      return;
    }
    const cleanTeachers = teachers
      .map((t) => ({
        ...t,
        fullName: t.fullName.trim(),
        telegramUsername: t.telegramUsername?.trim() || undefined,
      }))
      .filter((t) => t.fullName.length >= 2);
    const cleanLinks = links.map(cleanLink).filter((l) => l.label && l.url);
    create.mutate({
      groupId,
      name: name.trim(),
      shortName: shortName.trim() || undefined,
      icon: icon || undefined,
      teachers: cleanTeachers,
      links: cleanLinks.length ? cleanLinks : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Нова дисципліна" subtitle="Додайте назву, викладачів та корисні посилання" />

      <SubjectBasicsCard
        name={name}
        shortName={shortName}
        icon={icon}
        onName={setName}
        onShortName={setShortName}
        onIcon={setIcon}
      />

      <TeachersEditor
        groupId={groupId}
        subjectName={name}
        teachers={teachers}
        onChange={setTeachers}
      />

      <Section title="Корисні посилання">
        <LinksEditor links={links} onChange={setLinks} />
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
          {create.isPending ? 'Зберігаємо…' : 'Створити'}
        </button>
      </div>
    </div>
  );
}
