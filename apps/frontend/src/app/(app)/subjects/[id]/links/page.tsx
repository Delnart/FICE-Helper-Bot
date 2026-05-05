'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubjectLink, SubjectLinkReminderType } from '@fice/shared';
import { api } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/PageHeader';
import { Empty } from '../../../../../components/Empty';
import { haptic } from '../../../../../lib/telegram';

type LinkRow = SubjectLink;

const REMINDER_TYPE_OPTIONS: Array<{ value: SubjectLinkReminderType; label: string }> = [
  { value: 'lecture', label: 'Лекція' },
  { value: 'practice', label: 'Практика' },
  { value: 'lab', label: 'Лабораторна' },
];

interface SubjectDetail {
  _id: string;
  name: string;
  shortName?: string;
  links: LinkRow[];
  canManage: boolean;
  isTeacher: boolean;
}

type LinkSheetState =
  | { type: 'create' }
  | { type: 'menu'; index: number }
  | { type: 'edit'; index: number }
  | null;

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

  // Editable working copy — synced from server data once on first load and
  // after every successful save.
  const [draft, setDraft] = useState<LinkRow[]>([]);
  const [sheet, setSheet] = useState<LinkSheetState>(null);
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
    mutationFn: (links: LinkRow[]) =>
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

  function commit(next: LinkRow[], afterSave?: () => void) {
    setDraft(next);
    const cleaned = next
      .map((l) => ({
        ...l,
        label: l.label.trim(),
        url: l.url.trim(),
        showInLessonReminder: Boolean(l.showInLessonReminder),
        lessonReminderType: l.showInLessonReminder ? l.lessonReminderType ?? 'lecture' : undefined,
      }))
      .filter((l) => l.label && l.url);
    save.mutate(cleaned, {
      onSuccess: () => {
        afterSave?.();
      },
    });
  }

  function persist(next: LinkRow[], afterSave?: () => void) {
    commit(next, afterSave);
  }

  function openCreateSheet() {
    setError(null);
    setSheet({ type: 'create' });
  }

  function openMenuSheet(index: number) {
    setSheet({ type: 'menu', index });
  }

  function openEditSheet(index: number) {
    setSheet({ type: 'edit', index });
  }

  if (subject.isLoading || !subject.data) {
    return <div className="card text-sm text-ink-500">Завантаження…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Корисні посилання"
        subtitle={subject.data.shortName ?? subject.data.name}
        action={
          canEdit ? (
            <button
              type="button"
              className="btn-primary h-9 px-3 text-sm shadow-sm"
              onClick={openCreateSheet}
            >
              + Додати
            </button>
          ) : undefined
        }
      />

      {error ? <div className="card text-sm text-danger">{error}</div> : null}

      {(canEdit ? draft : subject.data.links).length ? (
        <div className="grid gap-3">
          {(canEdit ? draft : subject.data.links).map((l, i) => (
            <LinkCard
              key={i}
              index={i}
              row={l}
              canEdit={canEdit}
              onMenu={() => openMenuSheet(i)}
            />
          ))}
        </div>
      ) : (
        <Empty title="Посилань ще немає" />
      )}

      {sheet ? (
        sheet.type === 'menu' ? (
          <LinkMenuSheet
            row={(canEdit ? draft : subject.data.links)[sheet.index]}
            onClose={() => setSheet(null)}
            onOpen={() => {
              const row = (canEdit ? draft : subject.data.links)[sheet.index];
              if (!row) return;
              window.open(getLinkMeta(row.url).href || row.url, '_blank', 'noopener,noreferrer');
              setSheet(null);
            }}
            onEdit={() => setSheet({ type: 'edit', index: sheet.index })}
            onDelete={() => {
              const row = (canEdit ? draft : subject.data.links)[sheet.index];
              if (!row) return;
              if (window.confirm(`Видалити «${row.label || 'посилання'}»?`)) {
                persist(draft.filter((_, j) => j !== sheet.index), () => setSheet(null));
              }
            }}
          />
        ) : (
          <LinkFormSheet
            key={sheet.type === 'create' ? 'create' : `edit-${sheet.index}`}
            title={sheet.type === 'create' ? 'Нове посилання' : 'Редагування посилання'}
            subtitle={subject.data.shortName ?? subject.data.name}
            initialRow={
              sheet.type === 'create'
                ? createEmptyLinkRow()
                : draft[sheet.index] ?? createEmptyLinkRow()
            }
            onClose={() => setSheet(null)}
            onSave={(row) => {
              const cleaned = {
                ...row,
                label: row.label.trim(),
                url: row.url.trim(),
                showInLessonReminder: Boolean(row.showInLessonReminder),
                lessonReminderType: row.showInLessonReminder
                  ? row.lessonReminderType ?? 'lecture'
                  : undefined,
              };
              if (!cleaned.label || !cleaned.url) {
                setError('Заповніть назву й URL.');
                haptic('error');
                return;
              }
              if (sheet.type === 'create') {
                persist([...draft, cleaned], () => setSheet(null));
              } else {
                const next = draft.map((x, j) => (j === sheet.index ? cleaned : x));
                persist(next, () => setSheet(null));
              }
            }}
          />
        )
      ) : null}
    </div>
  );
}

function LinkCard({
  index,
  row,
  canEdit,
  onMenu,
}: {
  index: number;
  row: LinkRow;
  canEdit: boolean;
  onMenu: () => void;
}) {
  const linkMeta = getLinkMeta(row.url);
  if (canEdit) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-paper-300 bg-paper-50 shadow-card transition-colors hover:bg-paper-100">
        <a
          href={linkMeta.href || row.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Відкрити ${row.label || 'посилання'}`}
          className="block p-4 pr-14"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-ink-900 text-paper-50 font-semibold shadow-sm">
              {String(index + 1).padStart(2, '0')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-ink-900">{row.label}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="chip bg-paper-200 text-ink-700">{linkMeta.host || 'Без домену'}</span>
                <span className="truncate text-xs text-ink-500">
                  {linkMeta.displayUrl || 'З’явиться після введення URL'}
                </span>
                {row.showInLessonReminder ? (
                  <span className="chip bg-emerald-100 text-emerald-800">
                    Нагадування: {formatReminderType(row.lessonReminderType)}
                  </span>
                ) : null}
              </div>
            </div>
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-paper-200 text-ink-900">
              ↗
            </span>
          </div>
        </a>

        <button
          type="button"
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-paper-200 text-ink-900"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMenu();
          }}
          aria-label="Меню"
        >
          ⋯
        </button>
      </div>
    );
  }

  return (
    <a
      href={linkMeta.href || row.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Відкрити ${row.label || 'посилання'}`}
      className="overflow-hidden rounded-3xl border border-paper-300 bg-paper-50 p-4 shadow-card transition-colors hover:bg-paper-100"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-ink-900 text-paper-50 font-semibold shadow-sm">
          {String(index + 1).padStart(2, '0')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-ink-900">{row.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="chip bg-paper-200 text-ink-700">{linkMeta.host || 'Без домену'}</span>
            <span className="truncate text-xs text-ink-500">
              {linkMeta.displayUrl || 'З’явиться після введення URL'}
            </span>
            {row.showInLessonReminder ? (
              <span className="chip bg-emerald-100 text-emerald-800">
                Нагадування: {formatReminderType(row.lessonReminderType)}
              </span>
            ) : null}
          </div>
        </div>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-paper-200 text-ink-900">
          ↗
        </span>
      </div>
    </a>
  );
}

function LinkMenuSheet({
  row,
  onClose,
  onOpen,
  onEdit,
  onDelete,
}: {
  row: LinkRow;
  onClose: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const linkMeta = getLinkMeta(row.url);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-900/40 backdrop-blur-sm sm:items-center">
      <div className="absolute inset-0" onClick={onClose} role="button" aria-label="Закрити" />
      <div className="relative card w-full max-h-[85vh] overflow-y-auto rounded-b-none pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:max-w-md sm:rounded-2xl sm:pb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-[16px] font-semibold">Меню посилання</div>
            <div className="text-xs text-ink-500 truncate">{row.label || 'Без назви'}</div>
          </div>
          <button type="button" className="chip" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl bg-paper-100 p-3">
            <div className="text-sm font-medium text-ink-900 truncate">{row.label || 'Без назви'}</div>
            <div className="mt-1 text-xs text-ink-500 truncate">{linkMeta.displayUrl || row.url}</div>
            {row.showInLessonReminder ? (
              <div className="mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                Показувати в нагадуваннях: {formatReminderType(row.lessonReminderType)}
              </div>
            ) : null}
          </div>

          <button type="button" className="btn-primary w-full" onClick={onOpen}>
            Відкрити
          </button>
          <button type="button" className="btn-secondary w-full" onClick={onEdit}>
            Редагувати
          </button>
          <button type="button" className="btn-secondary w-full text-danger" onClick={onDelete}>
            Видалити
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkFormSheet({
  title,
  subtitle,
  initialRow,
  onClose,
  onSave,
}: {
  title: string;
  subtitle?: string;
  initialRow: LinkRow;
  onClose: () => void;
  onSave: (row: LinkRow) => void;
}) {
  const [row, setRow] = useState<LinkRow>(initialRow);
  const linkMeta = getLinkMeta(row.url);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-900/40 backdrop-blur-sm sm:items-center">
      <div className="absolute inset-0" onClick={onClose} role="button" aria-label="Закрити" />
      <div className="relative card w-full max-h-[85vh] overflow-y-auto rounded-b-none pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:max-w-md sm:rounded-2xl sm:pb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-[16px] font-semibold">{title}</div>
            {subtitle ? <div className="text-xs text-ink-500 truncate">{subtitle}</div> : null}
          </div>
          <button type="button" className="chip" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="label block mb-0">Назва</label>
            <input
              className="input"
              placeholder="Google Drive курсу"
              value={row.label}
              onChange={(e) => setRow({ ...row, label: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="label block mb-0">URL</label>
            <input
              className="input"
              placeholder="https://ecampus.kpi.ua/..."
              value={row.url}
              onChange={(e) => setRow({ ...row, url: e.target.value })}
            />
          </div>

          <div className="rounded-2xl border border-paper-300 p-3 space-y-3">
            <label className="flex items-center gap-3 text-sm font-medium text-ink-900">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-paper-400 text-ink-900"
                checked={Boolean(row.showInLessonReminder)}
                onChange={(e) =>
                  setRow({
                    ...row,
                    showInLessonReminder: e.target.checked,
                    lessonReminderType: e.target.checked ? row.lessonReminderType ?? 'lecture' : row.lessonReminderType,
                  })
                }
              />
              Показувати в нагадуваннях про пару
            </label>

            <div className="space-y-1.5">
              <label className="label block mb-0">Тип заняття</label>
              <select
                className="input"
                disabled={!row.showInLessonReminder}
                value={row.lessonReminderType ?? 'lecture'}
                onChange={(e) =>
                  setRow({ ...row, lessonReminderType: e.target.value as SubjectLinkReminderType })
                }
              >
                {REMINDER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-ink-500">
                Лінк буде показуватись тільки для вибраного типу заняття.
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-paper-100 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip bg-paper-200 text-ink-700">{linkMeta.host || 'Без домену'}</span>
              <span className="text-xs text-ink-500 truncate">
                {linkMeta.displayUrl || 'Домен з’явиться після введення URL'}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>
              Скасувати
            </button>
            <button type="button" className="btn-primary flex-1" onClick={() => onSave(row)}>
              Зберегти
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getLinkMeta(rawUrl: string): { href: string; host: string; displayUrl: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { href: '', host: '', displayUrl: '' };
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./i, '');
    const displayUrl = `${host}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
    return { href: url.toString(), host, displayUrl };
  } catch {
    return { href: trimmed, host: '', displayUrl: trimmed };
  }
}

function createEmptyLinkRow(): LinkRow {
  return {
    label: '',
    url: '',
    showInLessonReminder: false,
    lessonReminderType: 'lecture',
  };
}

function formatReminderType(type?: SubjectLinkReminderType): string {
  if (type === 'practice') return 'Практика';
  if (type === 'lab') return 'Лабораторна';
  return 'Лекція';
}

function getLinkHref(rawUrl: string): string {
  return getLinkMeta(rawUrl).href;
}

function getLinkHost(rawUrl: string): string {
  return getLinkMeta(rawUrl).host;
}

function getLinkDisplayUrl(rawUrl: string): string {
  return getLinkMeta(rawUrl).displayUrl;
}
