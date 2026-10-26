'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/uk';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { haptic } from '../../../lib/telegram';
import { subjectAcronym } from '../../../lib/name';
import { useIsTeacherOnly } from '../../../hooks/useMe';
import { PageHeader } from '../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { Icon } from '../../../components/icons';
import { pluralUk } from '../../../components/subjects/helpers';

interface HwRow {
  _id: string;
  title: string;
  subjectId?: string;
  subjectName?: string;
  deadline?: string;
  done?: boolean;
  points?: number;
  teamSize?: number;
  // Optional until the list endpoint returns them (mockup 11: card description, "виконано 24 жовт.").
  description?: string;
  doneAt?: string;
}

interface SubjectRow {
  _id: string;
  name: string;
  shortName?: string;
}

type GroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

const GROUPS: Array<[GroupKey, string]> = [
  ['overdue', 'Прострочені'],
  ['today', 'Сьогодні'],
  ['tomorrow', 'Завтра'],
  ['week', 'Цього тижня'],
  ['later', 'Пізніше'],
  ['none', 'Без дедлайну'],
];

function groupOf(deadline: string | undefined, now: Dayjs): GroupKey {
  if (!deadline) return 'none';
  const d = dayjs(deadline);
  if (d.isBefore(now)) return 'overdue';
  if (d.isSame(now, 'day')) return 'today';
  if (d.isSame(now.add(1, 'day'), 'day')) return 'tomorrow';
  if (!d.isAfter(now.endOf('week'))) return 'week';
  return 'later';
}

const fmt = (iso: string, pattern: string) => dayjs(iso).locale('uk').format(pattern);

export default function HomeworkListPage() {
  const qc = useQueryClient();
  const teacherOnly = useIsTeacherOnly();
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['hw-all'],
    queryFn: () => api<HwRow[]>('/homework'),
  });
  // Short names ("ОС", "БД") for the subject chips; falls back to an acronym of the full name.
  const subjects = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<SubjectRow[]>('/subjects'),
  });
  const shortOf = (h: HwRow) => {
    const s = subjects.data?.find((x) => x._id === h.subjectId);
    // The chip truncates, so a one-word name stays whole (the journal's 52px column cuts it to 3 letters).
    return s?.shortName || subjectAcronym(h.subjectName || s?.name || '', true);
  };

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api(`/homework/${id}/completion`, { method: 'PATCH', json: { done } }),
    onMutate: ({ id, done }) => {
      qc.setQueryData<HwRow[]>(['hw-all'], (list) =>
        list?.map((h) => (h._id === id ? { ...h, done } : h)),
      );
    },
    onSuccess: (_res, { id }) => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['hw', id] });
      qc.invalidateQueries({ queryKey: ['hw-pending-count'] });
      qc.invalidateQueries({ queryKey: ['subject-hw'] });
    },
    onError: () => haptic('error'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hw-all'] }),
  });

  const rows = data ?? [];
  const active = rows.filter((h) => !h.done);
  const done = rows
    .filter((h) => h.done)
    .sort((a, b) =>
      (b.doneAt ?? b.deadline ?? '').localeCompare(a.doneAt ?? a.deadline ?? ''),
    );
  const now = dayjs().locale('uk');
  // "здано вчасно": share of done tasks with a deadline that were ticked before it.
  const timed = done.filter((h) => h.deadline && h.doneAt);
  const onTime =
    !teacherOnly && timed.length
      ? Math.round(
          (timed.filter((h) => !dayjs(h.doneAt).isAfter(h.deadline)).length / timed.length) * 100,
        )
      : null;
  const groups = GROUPS.map(([key, title]) => ({
    key,
    title,
    items: active.filter((h) => groupOf(h.deadline, now) === key),
  })).filter((g) => g.items.length);

  // Teachers don't complete homework, so they get no checkbox.
  const check = (h: HwRow, className: string) =>
    teacherOnly ? null : (
      <button
        type="button"
        className={cn('flex flex-shrink-0 p-2.5', className)}
        aria-label={h.done ? 'Повернути в активні' : 'Позначити виконаним'}
        aria-pressed={!!h.done}
        disabled={toggle.isPending && toggle.variables?.id === h._id}
        onClick={() => toggle.mutate({ id: h._id, done: !h.done })}
      >
        <span className={cn('check', h.done && 'on')}>
          {h.done ? <Icon name="check" size={14} strokeWidth={3} /> : null}
        </span>
      </button>
    );

  const doneList = (items: HwRow[], className?: string) => (
    <div className={cn('card-flat flex flex-col px-3.5 py-1', className)}>
      {items.map((h, i) => (
        <Fragment key={h._id}>
          {i > 0 ? <div className="divider" /> : null}
          <div className="row-plain">
            {check(h, '-m-2.5')}
            <Link href={`/homework/${h._id}`} className="flex min-w-0 flex-1 flex-col text-ink">
              <span className="h3 truncate line-through decoration-ink-3">{h.title}</span>
              <span className="tiny faint truncate">
                {[
                  shortOf(h),
                  h.doneAt
                    ? `виконано ${fmt(h.doneAt, 'D MMM[.]')}`
                    : h.deadline
                      ? `дедлайн ${fmt(h.deadline, 'D MMM[.]')}`
                      : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Link>
          </div>
        </Fragment>
      ))}
    </div>
  );

  const activeCard = (h: HwRow, group: GroupKey) => {
    const tone = group === 'overdue' ? 'bad' : group === 'today' || group === 'tomorrow' ? 'warn' : null;
    return (
      <div
        key={h._id}
        className={cn(
          'card-flat flex items-start gap-3 p-3.5',
          tone === 'bad' && 'border-bad',
          tone === 'warn' && 'border-warn',
        )}
      >
        {check(h, '-mx-2.5 -mb-2.5 -mt-2')}
        <Link href={`/homework/${h._id}`} className="flex min-w-0 flex-1 flex-col gap-1.5 text-ink">
          <div className="flex items-start justify-between gap-2">
            <span className="h3 min-w-0 break-words text-base">{h.title}</span>
            {h.deadline && (group === 'week' || group === 'later') ? (
              <span className="flex flex-col items-end whitespace-nowrap">
                <span className="small font-semibold text-ink-2">
                  {fmt(h.deadline, group === 'week' ? 'dd, D' : 'D MMM[.]')}
                </span>
                {/* 23:59 is the default deadline time — only show a non-default one. */}
                {fmt(h.deadline, 'HH:mm') !== '23:59' ? (
                  <span className="tiny faint num">{fmt(h.deadline, 'HH:mm')}</span>
                ) : null}
              </span>
            ) : null}
          </div>
          {/* Mockup 11: only the urgent (highlighted) cards expand with the description. */}
          {tone && h.description ? (
            <span className="small muted line-clamp-2 break-words">{h.description}</span>
          ) : null}
          <div className={cn('meta', tone && 'mt-0.5')}>
            {shortOf(h) ? (
              <span className={cn('chip h-[22px] max-w-full', tone && 'chip-ink')}>
                <span className="truncate">{shortOf(h)}</span>
              </span>
            ) : null}
            {h.points ? (
              <span className="chip">
                {h.points} {pluralUk(h.points, ['бал', 'бали', 'балів'])}
              </span>
            ) : null}
            {h.teamSize && h.teamSize > 1 ? (
              <span className="chip">
                <Icon name="users" size={12} strokeWidth={2.2} />
                команда · {h.teamSize}
              </span>
            ) : null}
            {tone && h.deadline ? (
              <span className={cn('chip', tone === 'bad' && 'chip-bad')}>
                {tone === 'bad'
                  ? `прострочено · ${fmt(h.deadline, 'D MMM[.], HH:mm')}`
                  : `до ${fmt(h.deadline, 'HH:mm')}`}
              </span>
            ) : null}
          </div>
        </Link>
      </div>
    );
  };

  const switchTab = (next: 'active' | 'done') => {
    if (next === tab) return;
    haptic('selection');
    setTab(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Завдання"
        subtitle={
          rows.length
            ? `${active.length} ${pluralUk(active.length, ['активне', 'активні', 'активних'])} · ${done.length} виконано`
            : undefined
        }
        action={
          <>
            {onTime !== null ? (
              <div className="mt-1 flex flex-col items-end gap-1">
                <span className="num text-[22px] leading-none text-accent-text">{onTime}%</span>
                <span className="tiny faint whitespace-nowrap">здано вчасно</span>
              </div>
            ) : null}
            <Link href="/homework/new" className="icon-btn" aria-label="Додати завдання">
              <Icon name="plus" />
            </Link>
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} title="Не вдалося завантажити завдання" />
      ) : !data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty
          title="Завдань поки немає"
          icon="checkSquare"
          hint="Додане завдання побачить уся група."
          action={
            <Link href="/homework/new" className="btn btn-primary btn-md">
              <Icon name="plus" size={18} />
              Додати завдання
            </Link>
          }
        />
      ) : (
        <>
          <div className="seg" role="tablist" aria-label="Фільтр завдань">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'active'}
              className={cn(tab === 'active' && 'on')}
              onClick={() => switchTab('active')}
            >
              Активні · {active.length}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'done'}
              className={cn(tab === 'done' && 'on')}
              onClick={() => switchTab('done')}
            >
              Виконані
            </button>
          </div>

          {toggle.isError ? (
            <div role="alert" className="card-flat small text-bad">
              {toggle.error.message}
            </div>
          ) : null}

          {tab === 'done' ? (
            done.length ? (
              doneList(done)
            ) : (
              <Empty title="Ще нічого не виконано" icon="checkSquare" />
            )
          ) : (
            <>
              {groups.length ? (
                groups.map((g) => (
                  <section key={g.key} className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2">
                      <h2 className="h2">{g.title}</h2>
                      {g.key === 'today' || g.key === 'tomorrow' ? (
                        <span className="chip chip-warn">
                          {now.add(g.key === 'tomorrow' ? 1 : 0, 'day').format('dd, D MMM[.]')}
                        </span>
                      ) : null}
                      {g.key === 'overdue' ? (
                        <span className="chip chip-bad num">{g.items.length}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2">
                      {g.items.map((h) => activeCard(h, g.key))}
                    </div>
                  </section>
                ))
              ) : (
                <Empty title="Усе виконано" icon="checkSquare" hint="Нових завдань поки немає." />
              )}

              {done.length ? (
                <section className="flex flex-col gap-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="h2 faint">Нещодавно виконані</h2>
                    <button
                      type="button"
                      className="small -mr-1 -my-[13px] px-1 py-[13px] font-semibold text-accent-text"
                      onClick={() => switchTab('done')}
                    >
                      Усі {done.length}
                    </button>
                  </div>
                  {doneList(done.slice(0, 2), 'opacity-75')}
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
