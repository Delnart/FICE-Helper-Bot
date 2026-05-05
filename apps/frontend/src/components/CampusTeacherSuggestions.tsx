'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type TeacherRoleId = 'lecturer' | 'practice' | 'lab';

export interface TeacherRow {
  fullName: string;
  telegramUsername?: string;
  role: TeacherRoleId;
}

interface CampusSuggestion {
  fullName: string;
  telegramUsername?: string;
  roles: TeacherRoleId[];
}

const ROLE_LABEL: Record<TeacherRoleId, string> = {
  lecturer: 'Лектор',
  practice: 'Практика',
  lab: 'Лаборант',
};

/**
 * Renders a "Запропоновані з Кампусу" panel: one row per lecturer the Campus
 * group-schedule API associates with this subject. Each row has per-role
 * checkboxes (pre-checked from Campus). User clicks "Додати" → onAdd is called
 * with one TeacherRow per checked role.
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
  const enabled = !!groupId && subjectName.trim().length >= 2;
  const { data, isLoading } = useQuery({
    queryKey: ['campus-suggested-teachers', groupId, subjectName.trim().toLowerCase()],
    queryFn: () =>
      api<CampusSuggestion[]>('/subjects/teachers/suggest-from-campus', {
        query: { groupId: groupId!, subjectName: subjectName.trim() },
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
      .map((t) => keyForTeacher(t.fullName, t.telegramUsername))
      .filter(Boolean),
  );

  return (
    <section className="card space-y-3">
      <div>
        <div className="font-medium">Запропоновані з Кампусу</div>
        <div className="text-xs text-ink-500 mt-0.5">
          Знайдено в розкладі групи. Залиште лише потрібні ролі — і додайте.
        </div>
      </div>
      <div className="space-y-2">
        {suggestions.map((s) => {
          const id = keyForTeacher(s.fullName, s.telegramUsername);
          const set = picked[id] ?? new Set(s.roles);
          const alreadyAddedRoles = existing
            .filter(
              (t) =>
                keyForTeacher(t.fullName, t.telegramUsername) === id ||
                t.fullName.trim().toLowerCase() === s.fullName.trim().toLowerCase(),
            )
            .map((t) => t.role);
          const allAdded = s.roles.every((r) => alreadyAddedRoles.includes(r));

          return (
            <div
              key={id}
              className="rounded-xl border border-paper-300 p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{s.fullName}</div>
                  {s.telegramUsername ? (
                    <div className="text-xs text-ink-500 truncate">
                      @{s.telegramUsername.replace(/^@/, '')}
                    </div>
                  ) : null}
                </div>
                {allAdded ? (
                  <span className="chip text-success bg-success/10 flex-shrink-0">
                    Додано
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['lecturer', 'practice', 'lab'] as TeacherRoleId[]).map((r) => {
                  const suggested = s.roles.includes(r);
                  const checked = set.has(r);
                  const disabled = !suggested;
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        setPicked((m) => {
                          const cur = new Set(m[id] ?? s.roles);
                          if (cur.has(r)) cur.delete(r);
                          else cur.add(r);
                          return { ...m, [id]: cur };
                        });
                      }}
                      className={
                        'chip ' +
                        (checked
                          ? 'bg-accent text-paper-50'
                          : disabled
                            ? 'bg-paper-100 text-ink-300 cursor-not-allowed'
                            : 'bg-paper-100 text-ink-700')
                      }
                    >
                      {ROLE_LABEL[r]}
                      {checked ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn-secondary w-full text-sm"
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
                        keyForTeacher(r.fullName, r.telegramUsername) +
                          ':' +
                          r.role,
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
      </div>
    </section>
  );
}

/** Stable key for matching teachers by username if available, else by name. */
function keyForTeacher(fullName: string, telegramUsername?: string): string {
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
    const k = keyForTeacher(t.fullName, t.telegramUsername) + ':' + t.role;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
