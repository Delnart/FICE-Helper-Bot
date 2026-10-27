'use client';

import { Fragment, useState } from 'react';
import type { SubjectLink, SubjectLinkReminderType } from '@fice/shared';
import { cn, slideVars } from '../../lib/cn';
import { haptic } from '../../lib/telegram';
import { Icon, type IconName } from '../icons';
import { SUBJECT_ICONS, SUBJECT_ICON_LABELS, subjectIcon, type SubjectIconName } from '../SubjectIcon';
import { Sheet } from '../ui/Sheet';
import { Section } from '../ui/Section';
import { Toggle } from '../ui/Toggle';
import {
  mergeTeacherRows,
  ROLE_LABEL,
  TEACHER_ROLES,
  teacherKey,
  useCampusSuggestions,
  type CampusSuggestion,
  type TeacherRoleId,
  type TeacherRow,
} from '../CampusTeacherSuggestions';

/** Icons shown before "…" expands the picker (the mockup fits one row of six). */
const ICONS_COLLAPSED = 6;

/* ── Basics: name, short name, icon ─────────────────────────────────── */

/** `icon` is the stored override; '' means "picked automatically from the name". */
export function SubjectBasicsCard({
  name,
  shortName,
  icon,
  onName,
  onShortName,
  onIcon,
}: {
  name: string;
  shortName: string;
  icon: string;
  onName: (v: string) => void;
  onShortName: (v: string) => void;
  onIcon: (v: string) => void;
}) {
  const auto = subjectIcon(name);
  const selected = subjectIcon(name, icon);
  const [allIcons, setAllIcons] = useState(false);
  const head = SUBJECT_ICONS.slice(0, ICONS_COLLAPSED);
  // Collapsed, the current pick always stays visible (first, like in the mockup).
  const shown: readonly SubjectIconName[] = allIcons
    ? SUBJECT_ICONS
    : head.includes(selected)
      ? head
      : [selected, ...head.slice(0, ICONS_COLLAPSED - 1)];
  return (
    <section className="card-flat flex flex-col gap-3.5">
      <div className="flex gap-2.5">
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="s-name">
            Назва
          </label>
          <input
            id="s-name"
            className="input"
            placeholder="Наприклад: Дискретна математика"
            value={name}
            onChange={(e) => onName(e.target.value)}
          />
        </div>
        <div className="w-24">
          <label className="label" htmlFor="s-short">
            Скороч.
          </label>
          <input
            id="s-short"
            className="input text-center font-bold"
            placeholder={
              name
                .split(/[\s-]+/)
                .filter((w) => w.length > 2)
                .map((w) => [...w][0])
                .join('')
                .toUpperCase()
                .slice(0, 4) || 'ДМ'
            }
            value={shortName}
            onChange={(e) => onShortName(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="label mb-0">Іконка</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Іконка дисципліни">
          {shown.map((ic) => {
            const on = ic === selected;
            return (
              <button
                key={ic}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={SUBJECT_ICON_LABELS[ic]}
                className={cn('subj', on && 'subj-accent shadow-[0_0_0_3px_var(--accent-soft)]')}
                onClick={() => {
                  haptic('selection');
                  onIcon(ic === auto ? '' : ic);
                }}
              >
                <Icon name={ic} strokeWidth={1.9} />
              </button>
            );
          })}
          {allIcons ? null : (
            <button
              type="button"
              className="subj border border-dashed border-line-2 bg-transparent text-ink-3"
              aria-label="Ще іконки"
              onClick={() => setAllIcons(true)}
            >
              <Icon name="more" />
            </button>
          )}
        </div>
        {icon ? (
          <div className="flex items-center justify-between gap-2">
            <span className="tiny faint">Обрана вручну.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onIcon('')}>
              Підібрати автоматично
            </button>
          </div>
        ) : (
          <span className="tiny faint">Підібрана автоматично за назвою — можна змінити.</span>
        )}
      </div>
    </section>
  );
}

/* ── Teachers ───────────────────────────────────────────────────────── */

/** One card per person; the flat TeacherRow[] (one row per role) stays the source of truth. */
interface TeacherDraft {
  teacherUserId?: string;
  fullName: string;
  telegramUsername?: string;
  roles: TeacherRoleId[];
}

function groupTeachers(rows: TeacherRow[]): Array<TeacherDraft & { key: string }> {
  const out: Array<TeacherDraft & { key: string }> = [];
  for (const t of rows) {
    const key = teacherKey(t.fullName, t.telegramUsername);
    const g = out.find((x) => x.key === key);
    if (!g) out.push({ key, ...t, roles: [t.role] });
    else if (!g.roles.includes(t.role)) g.roles.push(t.role);
  }
  return out;
}

const tgLabel = (u?: string) => (u ? `@${u.replace(/^@/, '')}` : 'Telegram не вказано');

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const toggleRole = (roles: TeacherRoleId[], r: TeacherRoleId) =>
  roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];

function RoleChips({ roles, onToggle }: { roles: TeacherRoleId[]; onToggle: (r: TeacherRoleId) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ролі в дисципліні">
      {TEACHER_ROLES.map((r) => {
        const on = roles.includes(r);
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            className={cn('chip chip-btn', on && 'chip-accent')}
            onClick={() => onToggle(r)}
          >
            {ROLE_LABEL[r]}
          </button>
        );
      })}
    </div>
  );
}

/** A Campus lecturer not on the list yet: same card as a teacher, dashed, with "Додати". */
function SuggestionCard({ s, onAdd }: { s: CampusSuggestion; onAdd: (rows: TeacherRow[]) => void }) {
  const [roles, setRoles] = useState(s.roles);
  return (
    <div className="card-flat flex flex-col gap-3 border-dashed">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="h3 break-words">{s.fullName}</span>
          <span className="tiny faint truncate">З розкладу · {tgLabel(s.telegramUsername)}</span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm flex-shrink-0"
          disabled={!roles.length}
          onClick={() => {
            haptic('selection');
            onAdd(
              TEACHER_ROLES.filter((r) => roles.includes(r)).map((role) => ({
                fullName: s.fullName,
                telegramUsername: s.telegramUsername,
                role,
              })),
            );
          }}
        >
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Додати
        </button>
      </div>
      <RoleChips roles={roles} onToggle={(r) => setRoles(toggleRole(roles, r))} />
    </div>
  );
}

export function TeachersEditor({
  groupId,
  subjectName,
  teachers,
  onChange,
}: {
  groupId: string | null;
  subjectName: string;
  teachers: TeacherRow[];
  onChange: (next: TeacherRow[]) => void;
}) {
  const [sheet, setSheet] = useState<{ key: string | null; draft: TeacherDraft } | null>(null);
  const groups = groupTeachers(teachers);
  const campus = useCampusSuggestions(groupId, subjectName);
  // People already on the list are edited on their own card — don't show them twice.
  const fresh = campus.filter((s) => !teachers.some((t) => sameName(t.fullName, s.fullName)));

  /** Replace the rows of one person (key) — or append a new one (key = null) — keeping list order. */
  function putGroup(key: string | null, d: TeacherDraft) {
    const rows: TeacherRow[] = TEACHER_ROLES.filter((r) => d.roles.includes(r)).map((role) => ({
      teacherUserId: d.teacherUserId,
      fullName: d.fullName,
      telegramUsername: d.telegramUsername,
      role,
    }));
    if (key === null) return onChange(mergeTeacherRows([...teachers, ...rows]));
    const next: TeacherRow[] = [];
    let placed = false;
    for (const t of teachers) {
      if (teacherKey(t.fullName, t.telegramUsername) !== key) next.push(t);
      else if (!placed) {
        next.push(...rows);
        placed = true;
      }
    }
    onChange(mergeTeacherRows(next));
  }

  return (
    <Section
      title="Викладачі"
      aside={campus.length ? <span className="tiny faint">підказки з Кампус КПІ</span> : undefined}
    >
      {groups.length === 0 && fresh.length === 0 ? (
        <div className="card-soft small muted">Поки немає викладачів.</div>
      ) : null}
      {groups.map((g) => (
        <div key={g.key} className="card-flat flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="-my-[3px] flex min-w-0 flex-col gap-0.5 py-[3px] text-left"
              aria-label={`Редагувати: ${g.fullName}`}
              onClick={() => setSheet({ key: g.key, draft: g })}
            >
              <span className="h3 break-words">{g.fullName}</span>
              <span className="tiny faint truncate">{tgLabel(g.telegramUsername)}</span>
            </button>
            <button
              type="button"
              className="icon-btn-plain -mr-3 -mt-2.5"
              aria-label="Прибрати викладача"
              onClick={() =>
                onChange(teachers.filter((t) => teacherKey(t.fullName, t.telegramUsername) !== g.key))
              }
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <RoleChips
            roles={g.roles}
            onToggle={(r) => {
              // A person keeps at least one role; remove them with ✕ instead.
              if (g.roles.length === 1 && g.roles[0] === r) return haptic('error');
              haptic('selection');
              putGroup(g.key, { ...g, roles: toggleRole(g.roles, r) });
            }}
          />
        </div>
      ))}

      {fresh.map((s) => (
        <SuggestionCard
          key={teacherKey(s.fullName, s.telegramUsername)}
          s={s}
          onAdd={(rows) => onChange(mergeTeacherRows([...teachers, ...rows]))}
        />
      ))}

      <button
        type="button"
        className="btn btn-outline btn-block h-11 border-dashed"
        onClick={() =>
          setSheet({
            key: null,
            draft: { fullName: '', roles: [teachers.length ? 'practice' : 'lecturer'] },
          })
        }
      >
        <Icon name="plus" size={18} strokeWidth={2.2} />
        Додати викладача
      </button>

      {sheet ? (
        <TeacherSheet
          key={sheet.key ?? 'new'}
          initial={sheet.draft}
          isNew={sheet.key === null}
          onClose={() => setSheet(null)}
          onSave={(d) => {
            putGroup(sheet.key, d);
            setSheet(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function TeacherSheet({
  initial,
  isNew,
  onClose,
  onSave,
}: {
  initial: TeacherDraft;
  isNew: boolean;
  onClose: () => void;
  onSave: (d: TeacherDraft) => void;
}) {
  const [d, setD] = useState(initial);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    const fullName = d.fullName.trim();
    if (fullName.length < 2) return fail('Вкажіть ПІБ викладача.');
    if (!d.roles.length) return fail('Оберіть хоча б одну роль.');
    onSave({ ...d, fullName, telegramUsername: d.telegramUsername?.trim() || undefined });
  }
  function fail(msg: string) {
    setErr(msg);
    haptic('error');
  }

  return (
    <Sheet open onClose={onClose} title={isNew ? 'Новий викладач' : 'Викладач'}>
      <div>
        <label className="label" htmlFor="t-name">
          ПІБ
        </label>
        <input
          id="t-name"
          className="input"
          placeholder="ПІБ викладача"
          value={d.fullName}
          onChange={(e) => setD({ ...d, fullName: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor="t-tg">
          Telegram
        </label>
        <input
          id="t-tg"
          className="input"
          placeholder="@username (необовʼязково)"
          value={d.telegramUsername ?? ''}
          onChange={(e) => setD({ ...d, telegramUsername: e.target.value })}
        />
      </div>
      <div>
        <span className="label">Ролі</span>
        <RoleChips roles={d.roles} onToggle={(r) => setD({ ...d, roles: toggleRole(d.roles, r) })} />
      </div>
      {err ? <div className="small text-bad">{err}</div> : null}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
          Скасувати
        </button>
        <button type="button" className="btn btn-primary flex-[2]" onClick={save}>
          {isNew ? 'Додати' : 'Готово'}
        </button>
      </div>
    </Sheet>
  );
}

/* ── Links ──────────────────────────────────────────────────────────── */

const REMINDER_TYPES: Array<{ value: SubjectLinkReminderType; label: string }> = [
  { value: 'lecture', label: 'Лекція' },
  { value: 'practice', label: 'Практика' },
  { value: 'lab', label: 'Лабораторна' },
];

const REMINDER_ICON: Record<SubjectLinkReminderType, IconName> = {
  lecture: 'bookOpen',
  practice: 'task',
  lab: 'flask',
};

const reminderLabel = (t?: SubjectLinkReminderType) =>
  REMINDER_TYPES.find((o) => o.value === t)?.label ?? 'Лекція';

/** Trimmed copy; the reminder type only survives while the reminder is on. */
export function cleanLink(l: SubjectLink): SubjectLink {
  return {
    ...l,
    label: l.label.trim(),
    url: l.url.trim(),
    showInLessonReminder: Boolean(l.showInLessonReminder),
    lessonReminderType: l.showInLessonReminder ? l.lessonReminderType ?? 'lecture' : undefined,
  };
}

export function getLinkMeta(rawUrl: string): { href: string; host: string; displayUrl: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { href: '', host: '', displayUrl: '' };
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

type LinkSheetState = { type: 'menu'; index: number } | { type: 'form'; index: number | null } | null;

/**
 * Links card: rows open the link; with `onChange` each row gets a ⋯ menu
 * (open / edit / delete) and an "add" row. `onChange` may return a promise —
 * the sheet then closes only after it resolves (and shows the error otherwise).
 */
export function LinksEditor({
  links,
  onChange,
  saving,
}: {
  links: SubjectLink[];
  onChange?: (next: SubjectLink[]) => unknown;
  saving?: boolean;
}) {
  const [sheet, setSheet] = useState<LinkSheetState>(null);
  const [error, setError] = useState<string | null>(null);
  const current = sheet && sheet.index !== null ? links[sheet.index] : undefined;
  const close = () => setSheet(null);

  function commit(next: SubjectLink[]) {
    setError(null);
    Promise.resolve(onChange?.(next)).then(close, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти'),
    );
  }

  return (
    <>
      <div className="card-flat flex flex-col px-3.5 py-1">
        {links.map((l, i) => {
          const meta = getLinkMeta(l.url);
          return (
            <Fragment key={i}>
              {i > 0 ? <div className="divider" /> : null}
              <div className="row-plain justify-between">
                <a
                  href={meta.href || l.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Відкрити ${l.label || 'посилання'}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-ink"
                >
                  <span className="subj subj-sm">
                    <Icon
                      name={(l.showInLessonReminder && REMINDER_ICON[l.lessonReminderType ?? 'lecture']) || 'link'}
                      strokeWidth={1.9}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="h3 truncate">{l.label || 'Без назви'}</span>
                    <span className="tiny faint truncate">
                      {meta.host || 'Без домену'}
                      {l.showInLessonReminder ? ` · ${reminderLabel(l.lessonReminderType)}` : ''}
                    </span>
                  </span>
                </a>
                {onChange ? (
                  <button
                    type="button"
                    className="icon-btn-plain"
                    aria-label="Меню посилання"
                    onClick={() => {
                      setError(null);
                      setSheet({ type: 'menu', index: i });
                    }}
                  >
                    <Icon name="more" />
                  </button>
                ) : (
                  <Icon name="arrowUpRight" size={18} className="flex-shrink-0 text-ink-3" />
                )}
              </div>
            </Fragment>
          );
        })}
        {onChange ? (
          <>
            {links.length ? <div className="divider" /> : null}
            <button
              type="button"
              className="row-plain w-full text-left"
              onClick={() => {
                setError(null);
                setSheet({ type: 'form', index: null });
              }}
            >
              <span className="subj subj-sm">
                <Icon name="plus" strokeWidth={2.2} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="h3 text-accent-text">Додати посилання</span>
                {links.length === 0 ? (
                  <span className="tiny faint">Необовʼязково: Google Drive, сторінка курсу тощо.</span>
                ) : null}
              </span>
            </button>
          </>
        ) : null}
      </div>

      {sheet?.type === 'menu' && current ? (
        <Sheet open onClose={close} title="Посилання">
          <div className="card-soft flex flex-col gap-1">
            <span className="h3 truncate">{current.label || 'Без назви'}</span>
            <span className="tiny faint truncate">
              {getLinkMeta(current.url).displayUrl || current.url}
            </span>
            {current.showInLessonReminder ? (
              <span className="chip chip-ok mt-1 self-start">
                У нагадуваннях: {reminderLabel(current.lessonReminderType)}
              </span>
            ) : null}
          </div>
          {error ? <div className="small text-bad">{error}</div> : null}
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              window.open(getLinkMeta(current.url).href || current.url, '_blank', 'noopener,noreferrer');
              close();
            }}
          >
            <Icon name="arrowUpRight" size={18} />
            Відкрити
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => setSheet({ type: 'form', index: sheet.index })}
          >
            <Icon name="edit" size={18} />
            Редагувати
          </button>
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={saving}
            onClick={() => {
              if (window.confirm(`Видалити «${current.label || 'посилання'}»?`)) {
                commit(links.filter((_, j) => j !== sheet.index));
              }
            }}
          >
            <Icon name="trash" size={18} />
            Видалити
          </button>
        </Sheet>
      ) : null}

      {sheet?.type === 'form' ? (
        <LinkFormSheet
          key={sheet.index ?? 'new'}
          title={sheet.index === null ? 'Нове посилання' : 'Редагування посилання'}
          initial={
            current ?? { label: '', url: '', showInLessonReminder: false, lessonReminderType: 'lecture' }
          }
          saving={saving}
          error={error}
          onClose={close}
          onSave={(row) =>
            commit(
              sheet.index === null
                ? [...links, row]
                : links.map((x, j) => (j === sheet.index ? row : x)),
            )
          }
        />
      ) : null}
    </>
  );
}

function LinkFormSheet({
  title,
  initial,
  saving,
  error,
  onClose,
  onSave,
}: {
  title: string;
  initial: SubjectLink;
  saving?: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (row: SubjectLink) => void;
}) {
  const [row, setRow] = useState<SubjectLink>(initial);
  const [err, setErr] = useState<string | null>(null);
  const meta = getLinkMeta(row.url);

  return (
    <Sheet open onClose={onClose} title={title}>
      <div>
        <label className="label" htmlFor="l-label">
          Назва
        </label>
        <input
          id="l-label"
          className="input"
          placeholder="Google Drive курсу"
          value={row.label}
          onChange={(e) => setRow({ ...row, label: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor="l-url">
          URL
        </label>
        <input
          id="l-url"
          className="input"
          inputMode="url"
          placeholder="https://ecampus.kpi.ua/..."
          value={row.url}
          onChange={(e) => setRow({ ...row, url: e.target.value })}
        />
        <div className="hint truncate">
          {meta.displayUrl || 'Домен зʼявиться після введення URL'}
        </div>
      </div>
      <div className="card-soft flex flex-col gap-3 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="h3">Показувати в нагадуваннях про пару</span>
          <Toggle
            label="Показувати в нагадуваннях про пару"
            checked={Boolean(row.showInLessonReminder)}
            onChange={(v) =>
              setRow({
                ...row,
                showInLessonReminder: v,
                lessonReminderType: v ? row.lessonReminderType ?? 'lecture' : row.lessonReminderType,
              })
            }
          />
        </div>
        {row.showInLessonReminder ? (
          <>
            <div
              className="seg seg-slide"
              style={slideVars(
                REMINDER_TYPES.findIndex((o) => o.value === (row.lessonReminderType ?? 'lecture')),
                REMINDER_TYPES.length,
              )}
              role="radiogroup"
              aria-label="Тип заняття"
            >
              {REMINDER_TYPES.map((o) => {
                const on = (row.lessonReminderType ?? 'lecture') === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? 'on' : undefined}
                    onClick={() => setRow({ ...row, lessonReminderType: o.value })}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <span className="tiny faint">Лінк буде показуватись тільки для вибраного типу заняття.</span>
          </>
        ) : null}
      </div>
      {err ?? error ? <div className="small text-bad">{err ?? error}</div> : null}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
          Скасувати
        </button>
        <button
          type="button"
          className="btn btn-primary flex-[2]"
          disabled={saving}
          onClick={() => {
            const cleaned = cleanLink(row);
            if (!cleaned.label || !cleaned.url) {
              setErr('Заповніть назву й URL.');
              haptic('error');
              return;
            }
            setErr(null);
            onSave(cleaned);
          }}
        >
          {saving ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      </div>
    </Sheet>
  );
}
