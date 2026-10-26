'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubjectLink } from '@fice/shared';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../../../components/Empty';
import { haptic } from '../../../../../lib/telegram';
import { cleanLink, LinksEditor } from '../../../../../components/subject-edit/parts';

interface SubjectDetail {
  _id: string;
  name: string;
  shortName?: string;
  icon?: string;
  links: SubjectLink[];
  canManage: boolean;
  isTeacher: boolean;
}

/**
 * Useful-links page for a subject.
 * Both head/deputy (`canManage`) and teachers (`isTeacher`) can add / edit /
 * delete entries in-place. Backend uses PATCH /subjects/:id/links which
 * accepts the full new array — we mutate locally then send.
 */
export default function SubjectLinksPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const subject = useQuery({
    queryKey: ['subject', id],
    queryFn: () => api<SubjectDetail>(`/subjects/${id}`),
  });

  // Editable working copy — synced from server data once on first load.
  const [draft, setDraft] = useState<SubjectLink[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!hydrated && subject.data) {
      setDraft(subject.data.links ?? []);
      setHydrated(true);
    }
  }, [subject.data, hydrated]);

  const canEdit = !!(subject.data?.canManage || subject.data?.isTeacher);

  const save = useMutation({
    mutationFn: (links: SubjectLink[]) =>
      api(`/subjects/${id}/links`, { method: 'PATCH', json: { links } }),
    onSuccess: () => {
      haptic('success');
      void qc.invalidateQueries({ queryKey: ['subject', id] });
    },
    onError: () => haptic('error'),
  });

  /**
   * The draft changes only once the save succeeds — the editor keeps its sheet
   * open and shows the error otherwise (so a failed delete doesn't hide the row).
   */
  async function commit(next: SubjectLink[]) {
    await save.mutateAsync(next.map(cleanLink).filter((l) => l.label && l.url));
    setDraft(next);
  }

  const s = subject.data;
  const links = canEdit ? draft : s?.links ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Корисні посилання" subtitle={s ? s.shortName || s.name : undefined} />

      {subject.isLoading ? (
        <Loading />
      ) : !s ? (
        <ErrorState
          title="Не вдалося завантажити дисципліну"
          error={subject.error}
          onRetry={() => subject.refetch()}
        />
      ) : (
        canEdit || links.length ? (
          <LinksEditor links={links} onChange={canEdit ? commit : undefined} saving={save.isPending} />
        ) : (
          <Empty title="Посилань ще немає" icon="link" />
        )
      )}
    </div>
  );
}
