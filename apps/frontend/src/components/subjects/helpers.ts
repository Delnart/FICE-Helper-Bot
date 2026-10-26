import dayjs from 'dayjs';

export function pluralUk(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** 'сьогодні' / 'завтра' for a deadline within a day, otherwise null. */
export function dueSoon(deadline?: string): string | null {
  if (!deadline) return null;
  const d = dayjs(deadline).startOf('day').diff(dayjs().startOf('day'), 'day');
  return d === 0 ? 'сьогодні' : d === 1 ? 'завтра' : null;
}

/** A lesson from GET /schedule/now (current / next). */
export interface NowLesson {
  subjectId?: string;
  subjectName: string;
  startTime: string;
  endTime: string;
  room?: string;
  meetingUrl?: string;
  type?: string;
}

export const LESSON_TYPE_LABEL: Record<string, string> = {
  lecture: 'Лекція',
  practice: 'Практика',
  lab: 'Лабораторна',
  seminar: 'Семінар',
  other: 'Заняття',
};

/** Schedule lesson belongs to this subject: by id, or by full / short name. */
export function isLessonOf(
  l: NowLesson | null | undefined,
  s: { _id: string; name: string; shortName?: string },
): boolean {
  if (!l) return false;
  if (l.subjectId && l.subjectId === s._id) return true;
  const a = (l.subjectName ?? '').trim().toLowerCase();
  if (!a) return false;
  return a === s.name.trim().toLowerCase() || (!!s.shortName && a === s.shortName.trim().toLowerCase());
}

/** Raw queue document as returned by GET /queues. */
export interface RawQueue {
  _id: string;
  subjectId: string;
  slotsCount: number;
  rules?: { isOpen?: boolean; autoOpenAt?: string; autoCloseAt?: string };
  entries?: Array<{ slotIndex: number; userId: string; status?: string }>;
}

/** Same open/closed rule the backend uses for /queues/open. */
export function isQueueOpen(q: RawQueue, now = new Date()): boolean {
  let open = !!q.rules?.isOpen;
  if (q.rules?.autoOpenAt && new Date(q.rules.autoOpenAt) <= now) open = true;
  if (q.rules?.autoCloseAt && new Date(q.rules.autoCloseAt) <= now) open = false;
  return open;
}

/** Occupied slots (several people can share one slot with group submission). */
export function takenSlots(q: RawQueue): number {
  return new Set((q.entries ?? []).map((e) => e.slotIndex)).size;
}

/**
 * The subject's queue as the queue page sees it (/queues/by-subject picks the
 * oldest one). GET /queues is sorted newest first, so the last match wins.
 */
export function queueBySubject(queues: RawQueue[] | undefined): Map<string, RawQueue> {
  const map = new Map<string, RawQueue>();
  for (const q of queues ?? []) map.set(String(q.subjectId), q);
  return map;
}
