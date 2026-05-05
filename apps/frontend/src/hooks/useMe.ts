'use client';

import { useQuery } from '@tanstack/react-query';
import { api, getActiveGroup } from '../lib/api';

export type AccessReason = 'member' | 'teacher' | 'none';

export interface MeMembership {
  groupId: string;
  role: 'student' | 'deputy_head' | 'group_head' | 'teacher' | 'admin';
  groupName?: string;
  joinedAt?: string;
}

export interface Me {
  _id: string;
  telegramId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  fullName?: string;
  avatarUrl?: string;
  birthday?: string;
  memberships: MeMembership[];
  accessReason: AccessReason;
  campusLecturerId?: string;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/users/me'),
  });
}

/** Membership of the currently active group, or undefined if none chosen / none in app. */
export function useActiveMembership(): MeMembership | undefined {
  const me = useMe();
  if (typeof window === 'undefined') return undefined;
  const active = getActiveGroup();
  if (!active || !me.data) return undefined;
  return me.data.memberships.find((m) => m.groupId === active);
}

/** Convenience: true if the user can manage the active group (head / deputy / admin). */
export function useCanManage(): boolean {
  const m = useActiveMembership();
  if (!m) return false;
  return m.role === 'group_head' || m.role === 'deputy_head' || m.role === 'admin';
}

/**
 * True when the user's ONLY role in the app is as a teacher (no student /
 * deputy_head / group_head memberships). These users get a dedicated teacher UI.
 *
 * Anyone with a head / deputy / admin / student membership is *never* treated as
 * a teacher-only user, even if they still have leftover `campusLecturerId` or
 * a Subject reference — those are cleaned up by sheet sync, but the UI must
 * not flash the teacher home page in the meantime.
 */
export function useIsTeacherOnly(): boolean {
  const me = useMe();
  if (!me.data) return false;
  // Hard guard: any non-teacher membership wins. Heads/deputies/admins/students
  // get the regular UI even if leftover teacher data still exists in the DB.
  const hasNonTeacherMembership = me.data.memberships.some(
    (m) => m.role !== 'teacher',
  );
  if (hasNonTeacherMembership) return false;
  // No memberships at all but is referenced in subjects
  if (me.data.accessReason === 'teacher') return true;
  // Has memberships, but every single one is teacher role
  if (me.data.accessReason === 'member') {
    return (
      me.data.memberships.length > 0 &&
      me.data.memberships.every((m) => m.role === 'teacher')
    );
  }
  return false;
}
