'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { shortenName } from '../../../lib/name';
import { useActiveMembership, useCanManage } from '../../../hooks/useMe';
import { PageHeader } from '../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Icon } from '../../../components/icons';
import { SubjectTile } from '../../../components/SubjectIcon';
import {
  dueSoon,
  isLessonOf,
  isQueueOpen,
  pluralUk,
  queueBySubject,
  takenSlots,
  type NowLesson,
  type RawQueue,
} from '../../../components/subjects/helpers';

/** Raw subject document from GET /subjects. */
interface SubjectDto {
  _id: string;
  name: string;
  shortName?: string;
  icon?: string;
  teachers: Array<{ fullName: string }>;
  links?: Array<{ label: string; url: string }>;
  settings?: {
    hideHomework?: boolean;
    hideQueue?: boolean;
    hideLinks?: boolean;
    hideTeachers?: boolean;
  };
}

interface PendingHw {
  _id: string;
  subjectId: string;
  deadline?: string;
}

type Filter = 'all' | 'queue' | 'hw' | 'elective';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Усі' },
  { id: 'queue', label: 'З чергою' },
  { id: 'hw', label: 'Із завданнями' },
  { id: 'elective', label: 'Вибіркові' },
];

interface Chip {
  label: string;
  cls?: string;
}

export default function SubjectsPage() {
  const canManage = useCanManage();
  const groupName = useActiveMembership()?.groupName;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectDto[]>('/subjects'),
    staleTime: 30_000,
  });
  // Card chips: the same endpoints the old home cards / now-card used.
  const now = useQuery({
    queryKey: ['schedule-now'],
    queryFn: () => api<{ current: NowLesson | null; next: NowLesson | null }>('/schedule/now'),
  });
  const pending = useQuery({
    queryKey: ['hw-pending-count'],
    queryFn: () => api<PendingHw[]>('/homework/my/pending'),
    staleTime: 30_000,
  });
  const queues = useQuery({
    queryKey: ['queues-all'],
    queryFn: () => api<RawQueue[]>('/queues'),
  });
  const electives = useQuery({
    queryKey: ['schedule-electives'],
    queryFn: () => api<Array<{ subjectId?: string }>>('/schedule/electives'),
  });

  const cards = useMemo(() => {
    const queueMap = queueBySubject(queues.data);
    const electiveIds = new Set((electives.data ?? []).map((e) => e.subjectId).filter(Boolean));
    return (subjects.data ?? []).map((s) => {
      const queue = s.settings?.hideQueue ? undefined : queueMap.get(s._id);
      const queueOpen = !!queue && isQueueOpen(queue);
      const hw = s.settings?.hideHomework
        ? []
        : (pending.data ?? []).filter((h) => h.subjectId === s._id);
      const elective = electiveIds.has(s._id);
      const links = s.settings?.hideLinks ? 0 : (s.links?.length ?? 0);

      const chips: Chip[] = [];
      const next = now.data?.next;
      if (isLessonOf(now.data?.current, s)) chips.push({ label: 'зараз', cls: 'chip-lime' });
      else if (next && isLessonOf(next, s)) chips.push({ label: `далі о ${next.startTime}`, cls: 'chip-info' });
      if (queue) {
        const opensAt = queue.rules?.autoOpenAt ? new Date(queue.rules.autoOpenAt) : null;
        chips.push(
          queueOpen
            ? { label: `черга ${takenSlots(queue)}/${queue.slotsCount}`, cls: 'chip-ok' }
            : opensAt && opensAt > new Date()
              ? {
                  label: `черга з ${opensAt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}`,
                  cls: 'chip-info',
                }
              : { label: 'черга закрита' },
        );
      }
      if (hw.length) {
        const soon = hw.map((h) => dueSoon(h.deadline)).find(Boolean);
        if (soon) chips.push({ label: `ДЗ ${soon}`, cls: 'chip-warn' });
        if (!soon || hw.length > 1) chips.push({ label: `${hw.length} ДЗ` });
      }
      if (links) chips.push({ label: `${links} ${pluralUk(links, ['посилання', 'посилання', 'посилань'])}` });
      if (elective) chips.push({ label: 'вибіркова', cls: 'chip-accent' });

      const names = [...new Set(s.teachers.map((t) => t.fullName))];
      const teacher = !names.length
        ? 'Викладача не призначено'
        : shortenName(names[0]) + (names.length > 1 ? ` +${names.length - 1}` : '');

      return { s, chips, teacher, queueOpen, hasHw: hw.length > 0, elective };
    });
  }, [subjects.data, now.data, pending.data, queues.data, electives.data]);

  const counts: Record<Filter, number> = {
    all: cards.length,
    queue: cards.filter((c) => c.queueOpen).length,
    hw: cards.filter((c) => c.hasHw).length,
    elective: cards.filter((c) => c.elective).length,
  };
  const activeFilter = counts[filter] ? filter : 'all';

  const term = search.trim().toLowerCase();
  const visible = cards.filter(
    (c) =>
      (activeFilter === 'all' ||
        (activeFilter === 'queue' && c.queueOpen) ||
        (activeFilter === 'hw' && c.hasHw) ||
        (activeFilter === 'elective' && c.elective)) &&
      (!term ||
        [c.s.name, c.s.shortName ?? '', ...c.s.teachers.map((t) => t.fullName)].some((x) =>
          x.toLowerCase().includes(term),
        )),
  );

  const total = subjects.data?.length ?? 0;
  const subtitle = subjects.data
    ? [groupName, `${total} ${pluralUk(total, ['дисципліна', 'дисципліни', 'дисциплін'])}`]
        .filter(Boolean)
        .join(' · ')
    : groupName;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Предмети"
        subtitle={subtitle}
        action={
          canManage ? (
            <Link href="/subjects/new" className="icon-btn" aria-label="Додати дисципліну">
              <Icon name="plus" size={22} />
            </Link>
          ) : undefined
        }
      />

      {subjects.isLoading ? (
        <Loading />
      ) : subjects.isError ? (
        <ErrorState
          error={subjects.error}
          onRetry={() => subjects.refetch()}
          title="Не вдалося завантажити дисципліни"
        />
      ) : !total ? (
        <Empty
          title="Поки немає дисциплін"
          icon="book"
          hint="Староста може додати їх з розкладу"
          action={
            canManage ? (
              <Link href="/subjects/new" className="btn btn-primary btn-md">
                <Icon name="plus" size={18} /> Додати дисципліну
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="relative">
            <label
              htmlFor="subj-search"
              className="absolute left-3.5 top-0 inline-flex h-12 items-center text-ink-3"
            >
              <Icon name="search" />
            </label>
            <input
              id="subj-search"
              aria-label="Пошук дисциплін"
              className="input pl-11"
              placeholder="Назва, викладач…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {counts.queue || counts.hw || counts.elective ? (
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.filter((f) => counts[f.id]).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={activeFilter === f.id}
                  className={cn('chip chip-btn', activeFilter === f.id && 'chip-ink')}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}

          {visible.length ? (
            <section aria-label="Список дисциплін" className="grid grid-cols-2 gap-2.5">
              {visible.map(({ s, chips, teacher }) => {
                const display = s.shortName ?? s.name;
                return (
                  <Link
                    key={s._id}
                    href={`/subjects/${s._id}`}
                    className="card-flat flex min-h-[150px] flex-col gap-3 p-3.5"
                  >
                    <SubjectTile name={s.name} icon={s.icon} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="h3 line-clamp-3 break-words leading-[1.25]">{display}</span>
                      {s.shortName && s.name !== s.shortName ? (
                        <span className="tiny muted line-clamp-2">{s.name}</span>
                      ) : null}
                      <span className="tiny faint line-clamp-1">{teacher}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {chips.length ? (
                        chips.map((c) => (
                          <span key={c.label} className={cn('chip', c.cls)}>
                            {c.label}
                          </span>
                        ))
                      ) : (
                        <span className="chip text-ink-3">без активностей</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </section>
          ) : (
            <Empty title="Нічого не знайдено" icon="search" hint="Спробуйте іншу назву або фільтр" />
          )}
        </>
      )}
    </div>
  );
}
