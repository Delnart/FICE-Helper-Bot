'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type TeacherRoleId = 'lecturer' | 'practice' | 'lab';

export interface TeacherRow {
  teacherUserId?: string;
  fullName: string;
  telegramUsername?: string;
  role: TeacherRoleId;
}

export interface CampusSuggestion {
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
 * Lecturers the Campus group schedule associates with this subject, each with
 * the role(s) they teach it in. Empty when `groupId` / `subjectName` are missing
 * or the group isn't linked to Campus.
 */
export function useCampusSuggestions(groupId: string | null, subjectName: string): CampusSuggestion[] {
  // Debounced: each lookup hits the Campus API server-side, not once per keystroke.
  const [name, setName] = useState(subjectName.trim());
  useEffect(() => {
    const t = setTimeout(() => setName(subjectName.trim()), 400);
    return () => clearTimeout(t);
  }, [subjectName]);
  const enabled = !!groupId && name.length >= 2;
  const { data } = useQuery({
    queryKey: ['campus-suggested-teachers', groupId, name.toLowerCase()],
    queryFn: () =>
      api<CampusSuggestion[]>('/subjects/teachers/suggest-from-campus', {
        query: { groupId: groupId!, subjectName: name },
      }),
    enabled,
  });
  return (enabled && data) || [];
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
