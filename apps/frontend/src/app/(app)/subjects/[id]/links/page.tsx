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
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
      void qc.invalidateQueries({ queryKey: ['subject', id] });
    },
    onError: (err: Error) => {
      setError(err.message);
      haptic('error');
    },
  });

  /** Optimistically keeps the draft; the editor closes its sheet once the save resolves. */
  function commit(next: SubjectLink[]) {
    setDraft(next);
    return save.mutateAsync(next.map(cleanLink).filter((l) => l.label && l.url));
  }

  const s = subject.data;
  const links = canEdit ? draft : s?.links ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Корисні посилання" subtitle={s ? s.shortName ?? s.name : undefined} />

      {subject.isLoading ? (
        <Loading />
      ) : !s ? (
        <ErrorState
          title="Не вдалося завантажити дисципліну"
          error={subject.error}
          onRetry={() => subject.refetch()}
        />
      ) : (
        <>
          {error ? <div className="card-flat small text-bad">{error}</div> : null}
          {canEdit || links.length ? (
            <LinksEditor
              links={links}
              onChange={canEdit ? commit : undefined}
              saving={save.isPending}
            />
          ) : (
            <Empty title="Посилань ще немає" icon="link" />
          )}
        </>
      )}
    </div>
  );
}
