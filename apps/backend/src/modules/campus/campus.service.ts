import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface LecturerLesson {
  groupCampusId: string;
  groupName: string;
  subjectName: string;
  type: 'lecture' | 'practice' | 'lab' | 'seminar' | 'other';
  weekType: 1 | 2;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
  lessonNumber: number;
}

export interface CampusScheduleItem {
  subjectName: string;
  teacherNames: string[];
  type: 'lecture' | 'practice' | 'lab' | 'seminar' | 'other';
  dayOfWeek: number; // 1..6 (Monday..Saturday, KPI 6-day week)
  lessonNumber: number;
  startTime: string;
  endTime: string;
  weekType: 1 | 2; // first or second week parity
  room?: string;
}

export interface CampusGroupSummary {
  id: string;
  name: string;
}

interface GroupsIndexRow {
  id: number | string;
  name: string;
}

const GROUPS_INDEX_URLS = [
  // Static CDN (current 4-digit IDs — primary). Format: { id: number, name, faculty }
  'https://cdn.cloud.kpi.ua/schedule-groups-russian.json',
  // Older Ukrainian-name index (legacy, may have stale IDs)
  'https://cdn.cloud.kpi.ua/schedule-groups.json',
  // Live API endpoint (fallback)
  'https://api.campus.kpi.ua/schedule/groups',
];

@Injectable()
export class CampusService implements OnModuleInit {
  private readonly logger = new Logger(CampusService.name);
  private readonly http: AxiosInstance;
  private readonly cdn: AxiosInstance;

  private groupIndex: CampusGroupSummary[] = [];
  private groupIndexLoadedAt = 0;
  private readonly indexTtlMs = 24 * 60 * 60 * 1000; // 1 day

  private lecturerIndex: Array<{ id: string; name: string }> = [];
  private lecturerIndexLoadedAt = 0;
  private readonly lecturerIndexTtlMs = 24 * 60 * 60 * 1000; // 1 day

  private weekParityCache: { value: 1 | 2; fetchedAt: number } | null = null;
  private readonly weekParityTtlMs = 30 * 60 * 1000; // 30 min — week parity changes max once per week

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>('CAMPUS_API_BASE') ?? 'https://api.campus.kpi.ua',
      timeout: 15_000,
    });
    this.cdn = axios.create({
      timeout: 15_000,
    });
  }

  async onModuleInit(): Promise<void> {
    // Warm up the week-parity cache so the first request is served from RAM.
    void this.refreshWeekParity().catch(() => undefined);
  }

  async findGroupByName(name: string): Promise<CampusGroupSummary[]> {
    const index = await this.ensureGroupIndex();
    const needle = normalizeName(name);
    if (!needle) return [];
    const exact = index.filter((g) => normalizeName(g.name) === needle);
    if (exact.length) return exact;
    return index.filter((g) => normalizeName(g.name).includes(needle)).slice(0, 20);
  }

  async getGroupSchedule(campusGroupId: string): Promise<CampusScheduleItem[]> {
    try {
      const { data } = await this.http.get('/schedule/lessons', {
        params: { groupId: campusGroupId },
      });
      const items = normaliseSchedule(data);
      this.logger.log(`Campus schedule for ${campusGroupId}: ${items.length} lessons`);
      return items;
    } catch (err) {
      this.logger.warn(`Failed to fetch schedule for ${campusGroupId}: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Parity of the given date in KPI's 2-week academic cycle. Returns 1 or 2.
   * For "today" — uses the live cache if fresh, otherwise the local fallback.
   * For arbitrary dates — extrapolates from the live cache (anchor on the cached
   * Monday) or falls back to {@link computeFallbackParity} when there is no cache.
   */
  currentWeekParity(d: Date = new Date()): 1 | 2 {
    if (this.weekParityCache && Date.now() - this.weekParityCache.fetchedAt < this.weekParityTtlMs) {
      const today = new Date();
      const mondayToday = mondayUtc(today);
      const mondayD = mondayUtc(d);
      const weeksDelta = Math.round(
        (mondayD.getTime() - mondayToday.getTime()) / (7 * 86400000),
      );
      // If today is week N, and d is K weeks away → (N + K) parity.
      const cached = this.weekParityCache.value;
      const evenStart = cached === 1; // first week starts as parity-1
      const isEven = ((weeksDelta % 2) + 2) % 2 === 0;
      return (evenStart ? (isEven ? 1 : 2) : isEven ? 2 : 1) as 1 | 2;
    }
    return computeFallbackParity(d);
  }

  /**
   * Fetch the live week parity from Campus and cache it. Falls back to the local
   * computation if the request fails. Safe to call frequently — it short-circuits
   * within the cache TTL.
   */
  async refreshWeekParity(): Promise<1 | 2> {
    if (this.weekParityCache && Date.now() - this.weekParityCache.fetchedAt < this.weekParityTtlMs) {
      return this.weekParityCache.value;
    }
    try {
      const { data } = await this.http.get('/time/current');
      const raw = (data as { currentWeek?: number; data?: { currentWeek?: number } })
        ?.currentWeek ?? (data as { data?: { currentWeek?: number } })?.data?.currentWeek;
      const value: 1 | 2 = raw === 2 ? 2 : 1;
      this.weekParityCache = { value, fetchedAt: Date.now() };
      return value;
    } catch (err) {
      this.logger.warn(`Failed to fetch /time/current: ${(err as Error).message}`);
      const value = computeFallbackParity(new Date());
      this.weekParityCache = { value, fetchedAt: Date.now() };
      return value;
    }
  }

  async findTeacher(query: string) {
    const { data } = await this.http.get('/intellect/v2/find', { params: { Value: query } });
    return data;
  }

  async getTeacherProfile(userIdentifier: string) {
    const { data } = await this.http.get(`/intellect/v2/profile/${userIdentifier}`);
    return data;
  }

  /** Returns (and caches) the full campus lecturer list from the CDN. */
  async getLecturers(): Promise<Array<{ id: string; name: string }>> {
    const fresh = Date.now() - this.lecturerIndexLoadedAt < this.lecturerIndexTtlMs;
    if (fresh && this.lecturerIndex.length) return this.lecturerIndex;
    try {
      const { data } = await this.cdn.get(
        'https://cdn.cloud.kpi.ua/lecturer-list-russian.json',
      );
      const arr: Array<{ id: unknown; name: unknown }> = Array.isArray(data)
        ? data
        : (unwrapList<{ id: unknown; name: unknown }>(data) ?? []);
      this.lecturerIndex = arr
        .filter((r) => r?.id && r?.name)
        .map((r) => ({ id: String(r.id), name: String(r.name) }));
      this.lecturerIndexLoadedAt = Date.now();
      this.logger.log(`Loaded ${this.lecturerIndex.length} lecturers from CDN`);
    } catch (err) {
      this.logger.warn(`Failed to load lecturer list: ${(err as Error).message}`);
    }
    return this.lecturerIndex;
  }

  /**
   * Fuzzy-match a person's full name against the campus lecturer list.
   * Handles Ukrainian ↔ Russian character equivalences (і→и, ї→и, є→е, ё→е).
   */
  async findLecturerByName(fullName: string): Promise<{ id: string; name: string } | null> {
    const list = await this.getLecturers();
    const needle = normalizePersonName(fullName);
    if (!needle) return null;
    // Exact normalised match
    const exact = list.find((l) => normalizePersonName(l.name) === needle);
    if (exact) return exact;
    // All words (≥3 chars) of the needle appear in the candidate's name
    const words = needle.split(' ').filter((w) => w.length >= 3);
    if (words.length) {
      const partial = list.find((l) => {
        const n = normalizePersonName(l.name);
        return words.every((w) => n.includes(w));
      });
      if (partial) return partial;
    }
    return null;
  }

  /**
   * Return up to `limit` lecturers whose name contains any word from `query`.
   * Used to suggest candidates when an exact match fails.
   */
  async searchLecturers(
    query: string,
    limit = 10,
  ): Promise<Array<{ id: string; name: string }>> {
    const list = await this.getLecturers();
    const words = normalizePersonName(query)
      .split(' ')
      .filter((w) => w.length >= 2);
    if (!words.length) return [];
    return list
      .filter((l) => {
        const n = normalizePersonName(l.name);
        return words.some((w) => n.includes(w));
      })
      .slice(0, limit);
  }

  /**
   * Fetch a lecturer's schedule and return one entry per (group, subject) pair
   * across both calendar weeks.
   */
  async getLecturerLessons(lecturerId: string): Promise<LecturerLesson[]> {
    try {
      const { data } = await this.http.get('/schedule/lecturer', {
        params: { lecturerId },
      });
      return parseLecturerSchedule(data);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch lecturer schedule for ${lecturerId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Full schedule for a lecturer (CampusScheduleItem shape — same fields a
   * student schedule has: time, room, type, day-of-week, week-parity).
   * Reuses the same response parser as the group schedule because the API
   * shape (scheduleFirstWeek/scheduleSecondWeek) is identical.
   */
  async getLecturerSchedule(lecturerId: string): Promise<CampusScheduleItem[]> {
    try {
      const { data } = await this.http.get('/schedule/lecturer', {
        params: { lecturerId },
      });
      const items = normaliseSchedule(data);
      this.logger.log(`Campus lecturer schedule for ${lecturerId}: ${items.length} lessons`);
      return items;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch lecturer schedule (full) for ${lecturerId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async getTeacherRating(userIdentifier: string) {
    const { data } = await this.http.get(`/intellect/v2/persons/${userIdentifier}/rating`);
    return data;
  }

  private async ensureGroupIndex(): Promise<CampusGroupSummary[]> {
    const fresh = Date.now() - this.groupIndexLoadedAt < this.indexTtlMs;
    if (fresh && this.groupIndex.length) return this.groupIndex;

    for (const url of GROUPS_INDEX_URLS) {
      try {
        const { data } = await this.cdn.get(url);
        const arr = unwrapList<GroupsIndexRow>(data);
        if (arr && arr.length) {
          this.groupIndex = arr
            .filter((r) => r && r.name && r.id !== undefined && r.id !== null)
            .map((r) => ({ id: String(r.id), name: String(r.name) }));
          this.groupIndexLoadedAt = Date.now();
          this.logger.log(`Loaded ${this.groupIndex.length} groups from ${url}`);
          return this.groupIndex;
        }
      } catch (err) {
        this.logger.warn(`Groups index ${url} failed: ${(err as Error).message}`);
      }
    }
    return this.groupIndex;
  }
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[-–—\s]+/g, '');
}

/**
 * Normalise a Cyrillic person name for fuzzy comparison.
 * Maps Ukrainian-only letters to their closest Russian equivalents so that
 * "Іванченко Марія Василівна" ≈ "Иванченко Мария Васильевна".
 */
function normalizePersonName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ї/g, 'и')
    .replace(/і/g, 'и')
    .replace(/є/g, 'е')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/**
 * Parse a lecturer schedule response (same weekly shape as group schedule, but
 * pairs contain `groups: [{id, name}]` instead of a `lecturer` field).
 */
function parseLecturerSchedule(raw: unknown): LecturerLesson[] {
  const root = unwrapDataObject(raw);
  if (!root || typeof root !== 'object') return [];
  const obj = root as Record<string, unknown>;
  const out: LecturerLesson[] = [];

  for (const [weekKey, weekType] of [
    ['scheduleFirstWeek', 1 as const],
    ['scheduleSecondWeek', 2 as const],
  ] as Array<[string, 1 | 2]>) {
    const days = obj[weekKey];
    if (!Array.isArray(days)) continue;
    for (const day of days) {
      if (!day || typeof day !== 'object') continue;
      const d = day as Record<string, unknown>;
      const dow = mapDayName(String(d.day ?? d.dayName ?? ''));
      if (!dow) continue;
      const pairs = d.pairs ?? d.lessons;
      if (!Array.isArray(pairs)) continue;
      for (const p of pairs) {
        if (!p || typeof p !== 'object') continue;
        const pair = p as Record<string, unknown>;
        const startTime = trimTime(String(pair.time ?? pair.timeStart ?? ''));
        if (!startTime) continue;
        const subjectName = String(
          pair.name ?? pair.subjectName ?? pair.discipline_full_name ?? '',
        );
        if (!subjectName) continue;
        const tag = String(pair.tag ?? pair.type ?? '');
        const endTime = trimTime(String(pair.timeEnd ?? pair.time_end ?? '')) || pairEndFromStart(startTime);
        const lessonNumber = pairNumberFromStart(startTime);
        const location = pair.location as { title?: string; uri?: string } | string | null | undefined;
        const room =
          typeof location === 'string'
            ? location
            : location && typeof location === 'object' && location.title
              ? String(location.title)
              : undefined;
        const groups = Array.isArray(pair.groups)
          ? (pair.groups as Array<{ id?: unknown; name?: unknown }>)
          : [];
        for (const g of groups) {
          if (!g?.id || !g?.name) continue;
          out.push({
            groupCampusId: String(g.id),
            groupName: String(g.name),
            subjectName,
            type: inferType(tag),
            weekType,
            dayOfWeek: dow,
            startTime,
            endTime,
            room,
            lessonNumber,
          });
        }
      }
    }
  }
  return out;
}

/** Accepts an array, or a wrapped object like `{ data: [...] }` / `{ items: [...] }`. */
function unwrapList<T>(raw: unknown): T[] | null {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['data', 'items', 'lessons', 'result', 'results']) {
      const v = obj[key];
      if (Array.isArray(v)) return v as T[];
      if (v && typeof v === 'object') {
        const inner = unwrapList<T>(v);
        if (inner) return inner;
      }
    }
  }
  return null;
}

/**
 * Real KPI Campus shape (api.campus.kpi.ua/schedule/lessons?groupId=…):
 * {
 *   groupCode: "5627",
 *   scheduleFirstWeek: [
 *     { day: "Пн", pairs: [
 *         { lecturer:{name}, type:"Лек/Лаб/Прак/Сем", time:"10:25:00",
 *           name:"Subject", location:{title:"18-422"}|null, tag:"lec/lab/prac/sem", dates:[] }
 *     ]},
 *     ...
 *   ],
 *   scheduleSecondWeek: [ ... ]
 * }
 * Older shape (flat array of lessons) is also accepted for compatibility.
 */
function normaliseSchedule(raw: unknown): CampusScheduleItem[] {
  const root = unwrapDataObject(raw);
  if (root && typeof root === 'object') {
    const obj = root as Record<string, unknown>;
    if (Array.isArray(obj.scheduleFirstWeek) || Array.isArray(obj.scheduleSecondWeek)) {
      return parseWeeklyScheduleObject(obj);
    }
  }
  // Fallback: flat list
  const arr = unwrapList<Record<string, unknown>>(raw);
  if (!arr) return [];
  return arr
    .map((r) => {
      const type = inferType(String(r.lesson_type ?? r.type ?? r.tag ?? ''));
      const dayRaw = Number(r.day_number ?? r.dayOfWeek ?? r.day ?? 0);
      const weekRaw = Number(r.lesson_week ?? r.weekType ?? r.week ?? 1);
      return {
        subjectName: String(
          r.discipline_short_name ??
            r.discipline_full_name ??
            r.name ??
            r.subjectName ??
            r.lesson_name ??
            '',
        ),
        teacherNames: Array.isArray(r.teachers)
          ? (r.teachers as Array<{ name?: string; full_name?: string }>)
              .map((t) => t.full_name ?? t.name ?? '')
              .filter(Boolean)
          : r.teacherName
            ? [String(r.teacherName)]
            : r.teacher_name
              ? [String(r.teacher_name)]
              : [],
        type,
        dayOfWeek: clamp(dayRaw, 1, 6),
        lessonNumber: Number(r.lesson_number ?? r.lessonNumber ?? 0),
        startTime: String(r.time_start ?? r.startTime ?? ''),
        endTime: String(r.time_end ?? r.endTime ?? ''),
        weekType: (weekRaw === 2 ? 2 : 1) as 1 | 2,
        room: r.lesson_room ? String(r.lesson_room) : r.room ? String(r.room) : undefined,
      } satisfies CampusScheduleItem;
    })
    .filter((x) => x.subjectName && x.dayOfWeek >= 1 && x.dayOfWeek <= 6);
}

/** Unwrap one layer of `{data: ...}` if present. */
function unwrapDataObject(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (
    obj.data &&
    typeof obj.data === 'object' &&
    !Array.isArray(obj.data) &&
    !('groupCode' in obj || 'scheduleFirstWeek' in obj || 'scheduleSecondWeek' in obj)
  ) {
    return obj.data;
  }
  return raw;
}

function parseWeeklyScheduleObject(obj: Record<string, unknown>): CampusScheduleItem[] {
  const out: CampusScheduleItem[] = [];
  for (const [weekKey, weekType] of [
    ['scheduleFirstWeek', 1 as const],
    ['scheduleSecondWeek', 2 as const],
  ] as Array<[string, 1 | 2]>) {
    const days = obj[weekKey];
    if (!Array.isArray(days)) continue;
    for (const day of days) {
      if (!day || typeof day !== 'object') continue;
      const d = day as Record<string, unknown>;
      const dow = mapDayName(String(d.day ?? d.dayName ?? d.day_short ?? ''));
      if (!dow) continue;
      const pairs = d.pairs ?? d.lessons;
      if (!Array.isArray(pairs)) continue;
      for (const p of pairs) {
        if (!p || typeof p !== 'object') continue;
        const pair = p as Record<string, unknown>;
        const startTime = trimTime(String(pair.time ?? pair.timeStart ?? pair.time_start ?? ''));
        if (!startTime) continue;
        const endTime = trimTime(String(pair.timeEnd ?? pair.time_end ?? '')) || pairEndFromStart(startTime);
        const lessonNumber = pairNumberFromStart(startTime);
        const lecturer = pair.lecturer as { name?: string } | null | undefined;
        const teachersArr = pair.teachers as Array<{ name?: string; full_name?: string }> | undefined;
        const teacherNames = Array.isArray(teachersArr)
          ? teachersArr.map((t) => t.full_name ?? t.name ?? '').filter(Boolean)
          : lecturer?.name
            ? [String(lecturer.name)]
            : [];
        const location = pair.location as { title?: string; uri?: string } | string | null | undefined;
        const room =
          typeof location === 'string'
            ? location
            : location && typeof location === 'object' && location.title
              ? String(location.title)
              : undefined;
        const tag = String(pair.tag ?? pair.type ?? '');
        const subjectName = String(pair.name ?? pair.subjectName ?? pair.discipline_full_name ?? '');
        if (!subjectName) continue;
        out.push({
          subjectName,
          teacherNames,
          type: inferType(tag),
          dayOfWeek: dow,
          lessonNumber,
          startTime,
          endTime,
          weekType,
          room,
        });
      }
    }
  }
  return out;
}

/** Maps Ukrainian short day names ("Пн", "Вт"/"Вв", "Ср", "Чт", "Пт", "Сб") to 1..6. */
function mapDayName(name: string): number | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n.startsWith('пн') || n.startsWith('mon')) return 1;
  if (n.startsWith('вт') || n.startsWith('вв') || n.startsWith('tue')) return 2;
  if (n.startsWith('ср') || n.startsWith('wed')) return 3;
  if (n.startsWith('чт') || n.startsWith('thu')) return 4;
  if (n.startsWith('пт') || n.startsWith('fri')) return 5;
  if (n.startsWith('сб') || n.startsWith('sat')) return 6;
  return null;
}

/** "10:25:00" → "10:25"; passes "10:25" through. Empty string if not parseable. */
function trimTime(s: string): string {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Source of truth: https://api.campus.kpi.ua/schedule/lessons/slots
const KPI_PAIRS: Array<{ start: string; end: string }> = [
  { start: '08:30', end: '10:05' },
  { start: '10:25', end: '12:00' },
  { start: '12:20', end: '13:55' },
  { start: '14:15', end: '15:50' },
  { start: '16:10', end: '17:45' },
  { start: '18:05', end: '19:40' },
  { start: '20:00', end: '21:35' },
];

function pairNumberFromStart(start: string): number {
  const idx = KPI_PAIRS.findIndex((p) => p.start === start);
  if (idx >= 0) return idx + 1;
  // Fallback: nearest by start minute
  const target = toMinutes(start);
  let best = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < KPI_PAIRS.length; i++) {
    const d = Math.abs(toMinutes(KPI_PAIRS[i].start) - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i + 1;
    }
  }
  return best;
}

function pairEndFromStart(start: string): string {
  const found = KPI_PAIRS.find((p) => p.start === start);
  if (found) return found.end;
  // Fallback: 1h35m duration
  const m = toMinutes(start);
  if (m == null) return '';
  const end = m + 95;
  const hh = Math.floor(end / 60).toString().padStart(2, '0');
  const mm = (end % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function toMinutes(t: string): number {
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function inferType(s: string): CampusScheduleItem['type'] {
  const lower = s.toLowerCase();
  if (lower.includes('лек') || lower.startsWith('lec')) return 'lecture';
  if (lower.includes('прак') || lower.startsWith('prac')) return 'practice';
  if (lower.includes('лаб') || lower.startsWith('lab')) return 'lab';
  if (lower.includes('сем') || lower.startsWith('sem')) return 'seminar';
  return 'other';
}

/**
 * Local fallback for KPI's 2-week parity. Anchored on Jan 6 2025 = Monday of "first week".
 * Used only when the Campus /time/current endpoint is unreachable.
 */
function computeFallbackParity(d: Date): 1 | 2 {
  const anchor = Date.UTC(2025, 0, 6);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weeks = Math.floor((day - anchor) / (7 * 86400000));
  return ((weeks % 2) + 2) % 2 === 0 ? 1 : 2;
}

function mondayUtc(d: Date): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (r.getUTCDay() + 6) % 7; // 0..6 starting Monday
  r.setUTCDate(r.getUTCDate() - dow);
  return r;
}
