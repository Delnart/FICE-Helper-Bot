import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { ScheduleLesson, ScheduleLessonDocument } from './schedule.schema';
import { CampusService } from '../campus/campus.service';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { User, UserDocument } from '../users/user.schema';
import { RequestUser } from '../../common/types/request-user';

@Injectable()
export class ScheduleService {
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
    const [all, subjectMap] = await Promise.all([
      this.lessons.find({ groupId: new Types.ObjectId(groupId) }).exec(),
      this.buildSubjectMap(groupId),
    ]);
    const userObjectId = new Types.ObjectId(userId);
    const week = weekType ?? (await this.campus.refreshWeekParity());
    return all
      .filter((l) => {
        if (l.isElective && !l.electiveStudentIds.some((id) => id.equals(userObjectId))) return false;
        if (l.weekType !== 0 && l.weekType !== week) return false;
        return true;
      })
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
          isElective: l.isElective,
        };
      });
  }

  async getRawForGroup(groupId: string): Promise<ScheduleLessonDocument[]> {
    return this.lessons.find({ groupId: new Types.ObjectId(groupId) }).exec();
  }

  async getForGroup(
    groupId: string,
    weekType?: 1 | 2,
  ): Promise<Array<Record<string, unknown>>> {
    const [all, subjectMap] = await Promise.all([
      this.lessons.find({ groupId: new Types.ObjectId(groupId) }).exec(),
      this.buildSubjectMap(groupId),
    ]);
    const week = weekType ?? (await this.campus.refreshWeekParity());
    return all
      .filter((l) => l.weekType === 0 || l.weekType === week)
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
    const day = ((now.getDay() + 6) % 7) + 1;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = list.filter((l) => (l as { dayOfWeek: number }).dayOfWeek === day);
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
    const day = ((now.getDay() + 6) % 7) + 1; // Mon=1..Sat=6
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = list.filter((l) => (l as { dayOfWeek: number }).dayOfWeek === day);

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
    const day = ((now.getDay() + 6) % 7) + 1;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = list.filter((l) => (l as { dayOfWeek: number }).dayOfWeek === day);
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

  async chooseElective(userId: string, lessonId: string, add: boolean): Promise<void> {
    const userObjectId = new Types.ObjectId(userId);
    if (add) {
      await this.lessons.updateOne({ _id: lessonId }, { $addToSet: { electiveStudentIds: userObjectId } });
    } else {
      await this.lessons.updateOne({ _id: lessonId }, { $pull: { electiveStudentIds: userObjectId } });
    }
  }

  async syncFromCampus(user: RequestUser, groupId: string): Promise<number> {
    this.assertCanManage(user, groupId);
    const group = await this.groups.findById(groupId).exec();
    if (!group) throw new NotFoundException('Group not found');
    if (!group.campusGroupId) throw new NotFoundException('Group has no campusGroupId');

    const items = await this.campus.getGroupSchedule(group.campusGroupId);

    let upserted = 0;
    for (const item of items) {
      await this.lessons.updateOne(
        {
          groupId: group._id,
          dayOfWeek: item.dayOfWeek,
          lessonNumber: item.lessonNumber,
          weekType: item.weekType,
          subjectName: item.subjectName,
        },
        {
          $set: {
            startTime: item.startTime,
            endTime: item.endTime,
            teacherNames: item.teacherNames,
            type: item.type,
            room: item.room,
          },
        },
        { upsert: true },
      );
      upserted++;
    }
    return upserted;
  }

  private assertCanManage(user: RequestUser, groupId: string): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    if (level < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException();
    }
  }
}

/** Normalise a subject name for fuzzy lookup: lower-case, strip whitespace/punct. */
function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'«»()\[\].,!?:;]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
