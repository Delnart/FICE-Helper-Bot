import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { localDateKey, runsOn, ScheduleLesson, ScheduleLessonDocument } from './schedule.schema';
import { CampusScheduleItem, CampusService } from '../campus/campus.service';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { User, UserDocument } from '../users/user.schema';
import { RequestUser } from '../../common/types/request-user';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);
  private readonly syncInflight = new Map<string, Promise<number>>();

  constructor(
    @InjectModel(ScheduleLesson.name) private readonly lessons: Model<ScheduleLessonDocument>,
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly campus: CampusService,
  ) {}

  /**
   * Build a lookup `normalisedSubjectName → subjectId` for a group, so we can
   * deep-link schedule lessons to the FICE Subject page when the head has
   * created a matching Subject doc.
   */
  private async buildSubjectMap(groupId: string): Promise<Map<string, string>> {
    const subjects = await this.subjects
      .find({ groupId: new Types.ObjectId(groupId) }, { name: 1, shortName: 1 })
      .lean()
      .exec();
    const map = new Map<string, string>();
    for (const s of subjects) {
      const ids = String(s._id);
      if (s.name) map.set(normaliseName(s.name), ids);
      if (s.shortName) map.set(normaliseName(s.shortName), ids);
    }
    return map;
  }

  async getForUser(
    groupId: string,
    userId: string,
    weekType?: 1 | 2,
  ): Promise<Array<Record<string, unknown>>> {
    // Resolve the week first so Mongo filters it (polled every 60s by /schedule/now).
    const week = weekType ?? (await this.campus.refreshWeekParity());
    const [all, subjectMap] = await Promise.all([
      this.lessons
        .find({ groupId: new Types.ObjectId(groupId), weekType: { $in: [0, week] } })
        .lean()
        .exec(),
      this.buildSubjectMap(groupId),
    ]);
    return all
      // String compare: lean returns stored values as-is, and a legacy string id has no .equals().
      .filter((l) => !l.isElective || l.electiveStudentIds.some((id) => String(id) === userId))
      .map((l) => {
        const subjectId =
          (l.subjectId ? String(l.subjectId) : undefined) ??
          subjectMap.get(normaliseName(l.subjectName));
        return {
          _id: String(l._id),
          subjectId,
          dayOfWeek: l.dayOfWeek,
          lessonNumber: l.lessonNumber,
          startTime: l.startTime,
          endTime: l.endTime,
          subjectName: l.subjectName,
          teacherNames: l.teacherNames,
          room: l.room,
          meetingUrl: l.meetingUrl,
          type: l.type,
          weekType: l.weekType,
          dates: l.dates,
          isElective: l.isElective,
        };
      });
  }

  async getRawForGroup(groupId: string) {
    return this.lessons.find({ groupId: new Types.ObjectId(groupId) }).lean().exec();
  }

  async getForGroup(
    groupId: string,
    weekType?: 1 | 2,
  ): Promise<Array<Record<string, unknown>>> {
    const week = weekType ?? (await this.campus.refreshWeekParity());
    const [all, subjectMap] = await Promise.all([
      this.lessons
        .find({ groupId: new Types.ObjectId(groupId), weekType: { $in: [0, week] } })
        .lean()
        .exec(),
      this.buildSubjectMap(groupId),
    ]);
    return all
      .map((l) => {
        const subjectId =
          (l.subjectId ? String(l.subjectId) : undefined) ??
          subjectMap.get(normaliseName(l.subjectName));
        return {
          _id: String(l._id),
          subjectId,
          dayOfWeek: l.dayOfWeek,
          lessonNumber: l.lessonNumber,
          startTime: l.startTime,
          endTime: l.endTime,
          subjectName: l.subjectName,
          teacherNames: l.teacherNames,
          room: l.room,
          type: l.type,
          weekType: l.weekType,
          dates: l.dates,
          isElective: l.isElective,
        };
      });
  }

  async nowFor(
    groupId: string,
    userId: string,
  ): Promise<{ current: unknown; next: unknown; weekType: 1 | 2 }> {
    const week = await this.campus.refreshWeekParity();
    const list = await this.getForUser(groupId, userId, week);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = lessonsOn(list, now);
    const current =
      today.find((l) => {
        const [sH, sM] = (l as { startTime: string }).startTime.split(':').map(Number);
        const [eH, eM] = (l as { endTime: string }).endTime.split(':').map(Number);
        return sH * 60 + sM <= minutes && minutes < eH * 60 + eM;
      }) ?? null;
    const next =
      today
        .filter((l) => {
          const [sH, sM] = (l as { startTime: string }).startTime.split(':').map(Number);
          return sH * 60 + sM > minutes;
        })
        .sort((a, b) =>
          (a as { startTime: string }).startTime.localeCompare((b as { startTime: string }).startTime),
        )[0] ?? null;
    return { current, next, weekType: week };
  }

  /**
   * Current and next lessons for a whole group (no user-specific elective filtering).
   * Used by the bot /now and /left commands in group chats.
   */
  async nowForGroup(
    groupId: string,
  ): Promise<{ current: Record<string, unknown> | null; next: Record<string, unknown> | null; weekType: 1 | 2 }> {
    const week = await this.campus.refreshWeekParity();
    const list = await this.getForGroup(groupId, week);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = lessonsOn(list, now);

    const current =
      today.find((l) => {
        const cast = l as { startTime: string; endTime: string };
        const [sH, sM] = cast.startTime.split(':').map(Number);
        const [eH, eM] = cast.endTime.split(':').map(Number);
        return sH * 60 + sM <= minutes && minutes < eH * 60 + eM;
      }) ?? null;

    const next =
      today
        .filter((l) => {
          const [sH, sM] = (l as { startTime: string }).startTime.split(':').map(Number);
          return sH * 60 + sM > minutes;
        })
        .sort((a, b) =>
          (a as { startTime: string }).startTime.localeCompare(
            (b as { startTime: string }).startTime,
          ),
        )[0] ?? null;

    return { current, next, weekType: week };
  }

  // ── Session (exam) schedule ──────────────────────────────────────────────────

  /**
   * Exam schedule for a group (live from Campus by group's `campusGroupId`).
   * Returns one item per exam, already sorted by date.
   */
  async sessionsForGroup(groupId: string): Promise<unknown[]> {
    if (!Types.ObjectId.isValid(groupId)) return [];
    const group = await this.groups.findById(groupId).lean().exec();
    if (!group?.campusGroupId) return [];
    const items = await this.campus.getGroupSessionSchedule(group.campusGroupId);
    // Build subject map so the front can deep-link from session card → /subjects/:id
    const subjectMap = await this.buildSubjectMap(groupId);
    return items.map((s, idx) => ({
      _id: `sess-${group.campusGroupId}-${s.date}-${idx}`,
      subjectName: s.subjectName,
      subjectId: subjectMap.get(normaliseName(s.subjectName)),
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      type: s.type,
      room: s.room,
      teacherNames: s.teacherNames,
    }));
  }

  /**
   * Exam schedule for a teacher — every group they teach in, merged together
   * and sorted by date. Useful for the lecturer's session view.
   */
  async sessionsForLecturer(userId: string): Promise<unknown[]> {
    const user = await this.users.findById(userId).lean().exec();
    if (!user?.campusLecturerId) return [];
    // We don't have a direct lecturer-sessions endpoint, so iterate the
    // groups they teach (via subject.teachers) and collect their sessions.
    const subjects = await this.subjects
      .find({ 'teachers.teacherUserId': user._id }, { groupId: 1, name: 1, shortName: 1 })
      .lean()
      .exec();
    const groupIds = [...new Set(subjects.map((s) => String(s.groupId)))];
    const allGroups = await this.groups
      .find({ _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const subjectsByGroup = new Map<string, Set<string>>();
    for (const s of subjects) {
      const gid = String(s.groupId);
      const set = subjectsByGroup.get(gid) ?? new Set<string>();
      if (s.name) set.add(normaliseName(s.name));
      if (s.shortName) set.add(normaliseName(s.shortName));
      subjectsByGroup.set(gid, set);
    }

    const out: Array<Record<string, unknown>> = [];
    for (const g of allGroups) {
      if (!g.campusGroupId) continue;
      const items = await this.campus.getGroupSessionSchedule(g.campusGroupId);
      const subjectFilter = subjectsByGroup.get(String(g._id));
      for (const s of items) {
        // Only show exams for subjects the lecturer is actually assigned to.
        if (subjectFilter && !subjectFilter.has(normaliseName(s.subjectName))) continue;
        out.push({
          _id: `sess-${g.campusGroupId}-${s.date}-${s.subjectName}`,
          subjectName: s.subjectName,
          groupName: g.academicName,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          type: s.type,
          room: s.room,
        });
      }
    }
    out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return out;
  }

  // ── Lecturer schedule (teacher view) ─────────────────────────────────────────

  /**
   * Full week schedule for a teacher, fetched live from Campus by their
   * `campusLecturerId`. Output mirrors `getForUser` (same field names) so the
   * student schedule UI can render it without changes — just no `teacherNames`.
   */
  async lecturerWeek(
    userId: string,
    weekType?: 1 | 2,
  ): Promise<Array<Record<string, unknown>>> {
    const user = await this.users.findById(userId).lean().exec();
    if (!user) throw new NotFoundException('User not found');
    if (!user.campusLecturerId) {
      throw new BadRequestException(
        'Профіль викладача не підключено до Кампус КПІ — не вдалося отримати розклад.',
      );
    }
    const items = await this.campus.getLecturerLessons(user.campusLecturerId);
    const week = weekType ?? (await this.campus.refreshWeekParity());

    // Build subject map across ALL groups the lecturer teaches in DB so we can
    // deep-link from the schedule grid into our Subject pages where possible.
    const subjectIdByName = await this.buildSubjectMapForLecturer(user._id);

    return items
      .filter((l) => l.weekType === week)
      .map((l, idx) => ({
        _id: `lect-${user.campusLecturerId}-${l.groupCampusId}-${l.dayOfWeek}-${l.startTime}-${idx}`,
        subjectId:
          subjectIdByName.get(`${normaliseName(l.groupCampusId)}|${normaliseName(l.subjectName)}`) ??
          subjectIdByName.get(normaliseName(l.subjectName)),
        dayOfWeek: l.dayOfWeek,
        lessonNumber: l.lessonNumber,
        startTime: l.startTime,
        endTime: l.endTime,
        subjectName: l.subjectName,
        groupName: l.groupName,
        groupCampusId: l.groupCampusId,
        // Teachers don't need to see their own name on every lesson row.
        teacherNames: [] as string[],
        room: l.room,
        type: l.type,
        weekType: l.weekType,
        dates: l.dates,
        isElective: false,
      }));
  }

  /** Current and next lessons for a teacher (live from Campus). */
  async lecturerNow(
    userId: string,
  ): Promise<{ current: unknown; next: unknown; weekType: 1 | 2 }> {
    const week = await this.campus.refreshWeekParity();
    const list = await this.lecturerWeek(userId, week);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = lessonsOn(list, now);
    const current =
      today.find((l) => {
        const cast = l as { startTime: string; endTime: string };
        const [sH, sM] = cast.startTime.split(':').map(Number);
        const [eH, eM] = cast.endTime.split(':').map(Number);
        return sH * 60 + sM <= minutes && minutes < eH * 60 + eM;
      }) ?? null;
    const next =
      today
        .filter((l) => {
          const [sH, sM] = (l as { startTime: string }).startTime.split(':').map(Number);
          return sH * 60 + sM > minutes;
        })
        .sort((a, b) =>
          (a as { startTime: string }).startTime.localeCompare(
            (b as { startTime: string }).startTime,
          ),
        )[0] ?? null;
    return { current, next, weekType: week };
  }

  /**
   * Build subject map across all groups where this lecturer is listed in
   * `subjects.teachers.teacherUserId`. Used to surface deep-links from the
   * teacher schedule into the FICE Subject pages.
   */
  private async buildSubjectMapForLecturer(
    lecturerUserId: Types.ObjectId | unknown,
  ): Promise<Map<string, string>> {
    const subjects = await this.subjects
      .find({ 'teachers.teacherUserId': lecturerUserId }, { name: 1, shortName: 1, groupId: 1 })
      .lean()
      .exec();
    const map = new Map<string, string>();
    if (!subjects.length) return map;

    const groupIds = [...new Set(subjects.map((s) => String(s.groupId)))];
    const groups = await this.groups
      .find({ _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) } }, { campusGroupId: 1 })
      .lean()
      .exec();
    const campusGroupById = new Map(
      groups
        .filter((g) => !!g.campusGroupId)
        .map((g) => [String(g._id), String(g.campusGroupId)]),
    );

    for (const s of subjects) {
      const ids = String(s._id);
      const campusGroupId = campusGroupById.get(String(s.groupId))?.trim();
      if (campusGroupId) {
        const groupKey = normaliseName(campusGroupId);
        if (s.name) map.set(`${groupKey}|${normaliseName(s.name)}`, ids);
        if (s.shortName) map.set(`${groupKey}|${normaliseName(s.shortName)}`, ids);
      }
      if (s.name && !map.has(normaliseName(s.name))) map.set(normaliseName(s.name), ids);
      if (s.shortName && !map.has(normaliseName(s.shortName))) map.set(normaliseName(s.shortName), ids);
    }
    return map;
  }

  async chooseElective(user: RequestUser, lessonId: string, add: boolean): Promise<void> {
    const lesson = await this.lessons.findById(lessonId, { groupId: 1, subjectName: 1 }).lean().exec();
    if (!lesson) throw new NotFoundException('Lesson not found');
    // Members only — subject teachers pass GroupAccessService but don't enroll.
    if (!user.memberships.some((m) => m.groupId === String(lesson.groupId))) {
      throw new ForbiddenException('Тільки учасники групи можуть обирати вибіркові');
    }

    const targetNorm = normaliseName(lesson.subjectName);
    const allGroupLessons = await this.lessons
      .find({ groupId: lesson.groupId }, { subjectName: 1 })
      .lean()
      .exec();
    const matchingIds = allGroupLessons
      .filter((l) => normaliseName(l.subjectName) === targetNorm)
      .map((l) => l._id);

    const userObjectId = new Types.ObjectId(user.userId);
    if (matchingIds.length > 0) {
      if (add) {
        await this.lessons.updateMany(
          { _id: { $in: matchingIds } },
          { $addToSet: { electiveStudentIds: userObjectId } },
        );
      } else {
        await this.lessons.updateMany(
          { _id: { $in: matchingIds } },
          { $pull: { electiveStudentIds: userObjectId } },
        );
      }
    }
  }

  /**
   * Sync schedule from Campus for a specific group. Lessons are upserted in place
   * so their `_id`s stay stable — attendance records and reminder marks reference
   * them — and app-owned fields (subjectId, meetingUrl, elective flags/students)
   * survive. Lessons gone from Campus are deleted; new ones inherit elective
   * status/students by normalized subject name.
   */
  async syncGroupSchedule(group: { _id: Types.ObjectId; campusGroupId?: string }): Promise<number> {
    if (!group.campusGroupId) return 0;
    // Bind-time sync, manual sync and the cron can overlap; two concurrent runs
    // would both insert the same new lessons. Later callers join the running one.
    // ponytail: in-process only — fine for the single backend container.
    const key = String(group._id);
    const running = this.syncInflight.get(key);
    if (running) return running;
    const p = this.runGroupSync({ _id: group._id, campusGroupId: group.campusGroupId }).finally(
      () => this.syncInflight.delete(key),
    );
    this.syncInflight.set(key, p);
    return p;
  }

  private async runGroupSync(group: { _id: Types.ObjectId; campusGroupId: string }): Promise<number> {
    let items: CampusScheduleItem[];
    try {
      items = await this.campus.fetchGroupSchedule(group.campusGroupId);
    } catch (err) {
      // Campus down / timeout must never touch the stored schedule.
      this.logger.warn(`Campus schedule fetch for ${group.campusGroupId} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Кампус КПІ не відповідає — розклад не оновлено, спробуйте пізніше.');
    }
    if (items.length === 0) {
      // Could be a semester gap or a Campus format change — not worth wiping
      // lessons (and the attendance/elective data hanging off them) for.
      this.logger.warn(`Campus returned 0 lessons for ${group.campusGroupId}; keeping stored schedule`);
      return 0;
    }

    const existing = await this.lessons.find({ groupId: group._id }).lean().exec();

    // Elective students by normalized subject name, for lessons that are new this sync.
    const electiveMap = new Map<string, Set<string>>();
    for (const l of existing) {
      if (!l.isElective) continue;
      const norm = normaliseName(l.subjectName);
      const set = electiveMap.get(norm) ?? new Set<string>();
      for (const sId of l.electiveStudentIds) set.add(String(sId));
      electiveMap.set(norm, set);
    }

    // Campus may return several rows per slot (subgroups: other teacher/room; a slot
    // limited to dates: other dates) in no stable order, so match one-to-one, strongest
    // pairs first, so a weaker greedy pick can't take a lesson another row matches better.
    const buckets = new Map<string, typeof existing>();
    for (const l of existing) {
      const k = lessonKey(l);
      buckets.set(k, [...(buckets.get(k) ?? []), l]);
    }
    const pairs = items
      .flatMap((item) =>
        (buckets.get(lessonKey(item)) ?? []).map((lesson) => ({ item, lesson, score: matchScore(lesson, item) })),
      )
      .sort((a, b) => b.score - a.score);
    const matched = new Map<CampusScheduleItem, (typeof existing)[number]>();
    const taken = new Set<(typeof existing)[number]>();
    for (const { item, lesson } of pairs) {
      if (matched.has(item) || taken.has(lesson)) continue;
      matched.set(item, lesson);
      taken.add(lesson);
    }

    const ops: AnyBulkWriteOperation[] = [];
    const leftover = existing.filter((l) => !taken.has(l)).map((l) => l._id);
    if (leftover.length) ops.push({ deleteMany: { filter: { _id: { $in: leftover } } } });
    for (const item of items) {
      const prev = matched.get(item);
      if (prev) {
        const fields = {
          subjectName: item.subjectName,
          startTime: item.startTime,
          endTime: item.endTime,
          teacherNames: item.teacherNames,
          room: item.room,
          dates: item.dates,
        };
        // A doc from before `dates` differs from [] here, so it gets the field on its first sync.
        const unchanged = (Object.keys(fields) as Array<keyof typeof fields>).every(
          (k) => JSON.stringify(fields[k]) === JSON.stringify(prev[k]),
        );
        if (unchanged) continue;
        const { room, ...rest } = fields;
        ops.push({
          updateOne: {
            filter: { _id: prev._id },
            update: room === undefined ? { $set: rest, $unset: { room: 1 } } : { $set: fields },
          },
        });
        continue;
      }
      const preservedStudents = electiveMap.get(normaliseName(item.subjectName));
      ops.push({
        insertOne: {
          document: {
            groupId: group._id,
            dayOfWeek: item.dayOfWeek,
            lessonNumber: item.lessonNumber,
            weekType: item.weekType,
            subjectName: item.subjectName,
            startTime: item.startTime,
            endTime: item.endTime,
            teacherNames: item.teacherNames,
            type: item.type,
            room: item.room,
            dates: item.dates,
            isElective: preservedStudents !== undefined,
            electiveStudentIds: preservedStudents
              ? Array.from(preservedStudents).map((id) => new Types.ObjectId(id))
              : [],
          },
        },
      });
    }
    if (ops.length) await this.lessons.bulkWrite(ops);
    await this.groups.updateOne({ _id: group._id }, { $set: { scheduleSyncedAt: new Date() } }).exec();

    return items.length;
  }

  async syncFromCampus(user: RequestUser, groupId: string): Promise<number> {
    this.assertCanManage(user, groupId);
    const group = await this.groups.findById(groupId, { campusGroupId: 1 }).lean().exec();
    if (!group) throw new NotFoundException('Group not found');
    if (!group.campusGroupId) throw new NotFoundException('Group has no campusGroupId');
    return this.syncGroupSchedule(group);
  }

  /**
   * Automated background sync: twice a day for all groups linked to Campus KPI.
   * 03:30/15:30 — off the lunch peak and staggered before the Sheets (:40) and bot (:50) jobs.
   */
  @Cron('0 30 3,15 * * *')
  async autoSyncAllGroups(): Promise<void> {
    this.logger.log('Starting 12h automated schedule sync for all groups...');
    try {
      const groups = await this.groups
        .find({ campusGroupId: { $exists: true, $ne: null } }, { campusGroupId: 1, academicName: 1 })
        .lean()
        .exec();
      for (const group of groups) {
        try {
          const count = await this.syncGroupSchedule(group);
          this.logger.log(`Auto-synced schedule for group ${group.academicName}: ${count} lessons`);
        } catch (err) {
          this.logger.warn(
            `Auto-sync failed for group ${group.academicName}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`autoSyncAllGroups failed: ${(err as Error).message}`);
    }
  }

  /**
   * Head / deputy marks or unmarks all lessons of this discipline as elective
   * (e.g. lectures, practices, and labs are treated as 1 discipline).
   */
  async setElective(user: RequestUser, lessonId: string, isElective: boolean): Promise<void> {
    const lesson = await this.lessons.findById(lessonId, { groupId: 1, subjectName: 1 }).lean().exec();
    if (!lesson) throw new NotFoundException('Lesson not found');
    this.assertCanManage(user, String(lesson.groupId));

    const targetNorm = normaliseName(lesson.subjectName);
    const allGroupLessons = await this.lessons
      .find({ groupId: lesson.groupId }, { subjectName: 1 })
      .lean()
      .exec();
    const matchingIds = allGroupLessons
      .filter((l) => normaliseName(l.subjectName) === targetNorm)
      .map((l) => l._id);

    if (matchingIds.length > 0) {
      if (isElective) {
        await this.lessons.updateMany(
          { _id: { $in: matchingIds } },
          { $set: { isElective: true } },
        );
      } else {
        await this.lessons.updateMany(
          { _id: { $in: matchingIds } },
          { $set: { isElective: false, electiveStudentIds: [] } },
        );
      }
    }
  }

  /**
   * All elective disciplines for a group, grouped by discipline (subjectName) so
   * that lectures, practices, and labs appear together as 1 discipline.
   */
  async getElectivesForGroup(groupId: string): Promise<Array<Record<string, unknown>>> {
    const [all, subjectMap] = await Promise.all([
      this.lessons.find({ groupId: new Types.ObjectId(groupId), isElective: true }).lean().exec(),
      this.buildSubjectMap(groupId),
    ]);

    const grouped = new Map<
      string,
      {
        subjectName: string;
        sampleLessonId: string;
        lessonIds: string[];
        subjectId?: string;
        electiveStudentIds: Set<string>;
        lessons: Array<{
          _id: string;
          dayOfWeek: number;
          lessonNumber: number;
          startTime: string;
          endTime: string;
          type: string;
          weekType: number;
          teacherNames: string[];
          room?: string;
        }>;
      }
    >();

    for (const l of all) {
      const norm = normaliseName(l.subjectName);
      let entry = grouped.get(norm);
      if (!entry) {
        entry = {
          subjectName: l.subjectName,
          sampleLessonId: String(l._id),
          lessonIds: [],
          subjectId:
            (l.subjectId ? String(l.subjectId) : undefined) ??
            subjectMap.get(norm),
          electiveStudentIds: new Set<string>(),
          lessons: [],
        };
        grouped.set(norm, entry);
      }
      entry.lessonIds.push(String(l._id));
      for (const sId of l.electiveStudentIds) {
        entry.electiveStudentIds.add(String(sId));
      }
      entry.lessons.push({
        _id: String(l._id),
        dayOfWeek: l.dayOfWeek,
        lessonNumber: l.lessonNumber,
        startTime: l.startTime,
        endTime: l.endTime,
        type: l.type,
        weekType: l.weekType,
        teacherNames: l.teacherNames,
        room: l.room,
      });
    }

    return Array.from(grouped.values()).map((e) => ({
      _id: e.sampleLessonId,
      subjectName: e.subjectName,
      sampleLessonId: e.sampleLessonId,
      lessonIds: e.lessonIds,
      subjectId: e.subjectId,
      isElective: true,
      electiveStudentIds: Array.from(e.electiveStudentIds),
      lessons: e.lessons.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.lessonNumber - b.lessonNumber),
    }));
  }

  private assertCanManage(user: RequestUser, groupId: string): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    if (level < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException();
    }
  }
}

/** Natural identity of a lesson slot, shared by Campus items and stored lessons. */
function lessonKey(l: Pick<ScheduleLesson, 'dayOfWeek' | 'lessonNumber' | 'type' | 'subjectName'> & { weekType: number }): string {
  return `${l.dayOfWeek}|${l.lessonNumber}|${l.weekType}|${l.type}|${normaliseName(l.subjectName)}`;
}

/**
 * Same dates (8) beat shared dates (4 plus their share of both lists, so under 5) beat none,
 * then same teachers (2), then same room (1). Dates come first because slot rows often differ
 * only by them: without this, Campus's unstable order would shuffle `_id`s and with them
 * attendance records and reminder marks. A doc from before `dates` counts as undated.
 */
function matchScore(l: Pick<ScheduleLesson, 'dates' | 'teacherNames' | 'room'>, item: CampusScheduleItem): number {
  const dates = l.dates ?? [];
  const shared = dates.filter((d) => item.dates.includes(d)).length;
  const union = dates.length + item.dates.length - shared;
  return (
    (shared === union ? 8 : shared ? 4 + shared / union : 0) +
    (JSON.stringify(l.teacherNames) === JSON.stringify(item.teacherNames) ? 2 : 0) +
    ((l.room ?? '') === (item.room ?? '') ? 1 : 0)
  );
}

/** The lessons of `list` that run on the calendar day of `now`. */
function lessonsOn(list: Array<Record<string, unknown>>, now: Date): Array<Record<string, unknown>> {
  const weekday = ((now.getDay() + 6) % 7) + 1; // Mon=1..Sat=6
  const day = localDateKey(now);
  return list.filter((l) => l.dayOfWeek === weekday && runsOn(l as { dates?: string[] }, day));
}

/** Normalise a subject name for fuzzy lookup: lower-case, strip whitespace/punct. */
function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'«»()\[\].,!?:;]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
