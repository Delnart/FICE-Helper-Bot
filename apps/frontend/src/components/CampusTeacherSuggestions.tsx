'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/cn';

export type TeacherRoleId = 'lecturer' | 'practice' | 'lab';

export interface TeacherRow {
  teacherUserId?: string;
  fullName: string;
  telegramUsername?: string;
  role: TeacherRoleId;
}

interface CampusSuggestion {
  fullName: string;
  telegramUsername?: string;
  roles: TeacherRoleId[];
}

export const TEACHER_ROLES: TeacherRoleId[] = ['lecturer', 'practice', 'lab'];

export const ROLE_LABEL: Record<TeacherRoleId, string> = {
  lecturer: 'Лектор',
  practice: 'Практика',
  lab: 'Лабораторні',
};

/**
 * "Підказки з Кампус КПІ" card: one block per lecturer the Campus
 * group-schedule API associates with this subject. Each block has per-role
 * toggle chips (pre-selected from Campus). "Додати" → onAdd is called
 * with one TeacherRow per selected role.
 *
 * Hidden when `groupId` or `subjectName` are empty / nothing returned.
 */
export function CampusTeacherSuggestions({
  groupId,
  subjectName,
  existing,
  onAdd,
}: {
  groupId: string | null;
  subjectName: string;
  existing: TeacherRow[];
  onAdd: (rows: TeacherRow[]) => void;
}) {
  // Debounced: each lookup hits the Campus API server-side, not once per keystroke.
  const [name, setName] = useState(subjectName.trim());
  useEffect(() => {
    const t = setTimeout(() => setName(subjectName.trim()), 400);
    return () => clearTimeout(t);
  }, [subjectName]);
  const enabled = !!groupId && name.length >= 2;
  const { data, isLoading } = useQuery({
    queryKey: ['campus-suggested-teachers', groupId, name.toLowerCase()],
    queryFn: () =>
      api<CampusSuggestion[]>('/subjects/teachers/suggest-from-campus', {
        query: { groupId: groupId!, subjectName: name },
      }),
    enabled,
  });

  // Per-row state: which roles are checked. Defaults to "all roles Campus
  // suggested" so a single click adds the lecturer with the right role(s).
  const [picked, setPicked] = useState<Record<string, Set<TeacherRoleId>>>({});

  const suggestions = useMemo(() => data ?? [], [data]);

  if (!enabled || isLoading || suggestions.length === 0) return null;

  const existingKeys = new Set(
    existing
      .map((t) => teacherKey(t.fullName, t.telegramUsername))
      .filter(Boolean),
  );

  return (
    <section className="card-flat flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="eyebrow">Підказки з Кампус КПІ</span>
        <span className="tiny faint">
          Знайдено в розкладі групи. Залиште лише потрібні ролі — і додайте.
        </span>
      </div>
      {suggestions.map((s, i) => {
        const id = teacherKey(s.fullName, s.telegramUsername);
        const set = picked[id] ?? new Set(s.roles);
        const alreadyAddedRoles = existing
          .filter(
            (t) =>
              teacherKey(t.fullName, t.telegramUsername) === id ||
              t.fullName.trim().toLowerCase() === s.fullName.trim().toLowerCase(),
          )
          .map((t) => t.role);
        const allAdded = s.roles.every((r) => alreadyAddedRoles.includes(r));

        return (
          <div key={id} className="flex flex-col gap-2.5">
            {i > 0 ? <div className="divider" /> : null}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="h3 truncate">{s.fullName}</span>
                <span className="tiny faint truncate">
                  {s.telegramUsername
                    ? `@${s.telegramUsername.replace(/^@/, '')}`
                    : 'Telegram не вказано'}
                </span>
              </div>
              {allAdded ? <span className="chip chip-ok flex-shrink-0">Додано</span> : null}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ролі в дисципліні">
              {TEACHER_ROLES.map((r) => {
                const checked = set.has(r);
                const disabled = !s.roles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={disabled}
                    aria-pressed={checked}
                    onClick={() => {
                      if (disabled) return;
                      setPicked((m) => {
                        const cur = new Set(m[id] ?? s.roles);
                        if (cur.has(r)) cur.delete(r);
                        else cur.add(r);
                        return { ...m, [id]: cur };
                      });
                    }}
                    className={cn('chip chip-btn', checked && 'chip-accent')}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-md btn-block"
              disabled={set.size === 0}
              onClick={() => {
                const rows: TeacherRow[] = [...set].map((role) => ({
                  fullName: s.fullName,
                  telegramUsername: s.telegramUsername,
                  role,
                }));
                // Filter out roles already in `existing` to avoid duplicates.
                const fresh = rows.filter(
                  (r) =>
                    !existingKeys.has(
                      teacherKey(r.fullName, r.telegramUsername) + ':' + r.role,
                    ) && !alreadyAddedRoles.includes(r.role),
                );
                onAdd(fresh.length ? fresh : rows);
              }}
            >
              Додати з обраними ролями
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** Stable key for matching teachers by username if available, else by name. */
export function teacherKey(fullName: string, telegramUsername?: string): string {
  return (
    (telegramUsername?.replace(/^@/, '').toLowerCase() ?? '') +
    '|' +
    fullName.trim().toLowerCase()
  );
}

/**
 * Combine teacher rows, dropping exact duplicates of (key, role). Keeps order
 * of first occurrence so the existing list isn't reshuffled visibly.
 */
export function mergeTeacherRows(rows: TeacherRow[]): TeacherRow[] {
  const seen = new Set<string>();
  const out: TeacherRow[] = [];
  for (const t of rows) {
    const k = teacherKey(t.fullName, t.telegramUsername) + ':' + t.role;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
