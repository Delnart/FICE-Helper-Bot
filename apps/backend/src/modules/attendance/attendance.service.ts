import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttendanceStatus, Role, ROLE_LEVEL } from '@fice/shared';
import { AttendanceRecord, AttendanceRecordDocument } from './attendance.schema';
import { UpsertAttendanceDto } from './dto/attendance.dto';
import { RequestUser } from '../../common/types/request-user';
import { ScheduleLesson, ScheduleLessonDocument } from '../schedule/schedule.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { User, UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { CampusService } from '../campus/campus.service';
import { ManualStudentsService } from '../manual-students/manual-students.service';

export interface UserAttendanceStats {
  userId: string;
  totalLessons: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export interface WeekGridLesson {
  _id: string;
  subjectId?: string;
  subjectName: string;
  type: string;
  dayOfWeek: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  date: string; // ISO date for this concrete instance in the week
  weekType: 0 | 1 | 2;
}

export interface WeekGridStudent {
  _id: string;
  fullName: string;
  username?: string;
  /** True for placeholder entries added manually by the head — not a real Telegram user. */
  isManual?: boolean;
}

export interface WeekGridMark {
  studentId: string;
  lessonId: string;
  date: string;
  status: AttendanceStatus;
}

export interface WeekGridResponse {
  weekStart: string;
  weekType: 1 | 2;
  lessons: WeekGridLesson[];
  students: WeekGridStudent[];
  marks: WeekGridMark[];
  perStudentWeek: Record<string, { absent: number; excused: number; late: number }>;
  perStudentTotal: Record<string, { absent: number; excused: number; late: number }>;
  perLessonWeek: Record<string, { present: number; absent: number; excused: number; late: number }>;
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectModel(AttendanceRecord.name) private readonly records: Model<AttendanceRecordDocument>,
    @InjectModel(ScheduleLesson.name) private readonly lessons: Model<ScheduleLessonDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly users: UsersService,
    private readonly campus: CampusService,
    private readonly manualStudents: ManualStudentsService,
  ) {}

  async weekGrid(groupId: string, weekStart?: Date): Promise<WeekGridResponse> {
    const start = weekStart ? mondayOf(weekStart) : mondayOf(new Date());
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const weekType = this.campus.currentWeekParity(start);

    // Lessons of this group whose weekType matches (0 = both, 1/2 = first/second)
    const lessonsRaw = await this.lessons
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean()
      .exec();
    const weekLessons = lessonsRaw.filter(
      (l) => l.weekType === 0 || l.weekType === weekType,
    );
    const lessons: WeekGridLesson[] = weekLessons.map((l) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + (l.dayOfWeek - 1));
      return {
        _id: String(l._id),
        subjectId: l.subjectId ? String(l.subjectId) : undefined,
        subjectName: l.subjectName,
        type: l.type,
        dayOfWeek: l.dayOfWeek,
        lessonNumber: l.lessonNumber,
        startTime: l.startTime,
        endTime: l.endTime,
        date: date.toISOString(),
        weekType: l.weekType,
      };
    });

    // Real Telegram members + manual placeholder entries the head added by hand.
    const [members, manualDocs] = await Promise.all([
      this.users.listGroupMembersForUi(groupId),
      this.manualStudents.listForGroup(groupId),
    ]);
    // Index real members by normalised name → username, so a manual entry with
    // a matching name can surface that user's @handle as a hint.
    const usernameByName = new Map<string, string>();
    for (const m of members) {
      if (m.username) usernameByName.set(normaliseName(m.fullName), m.username);
    }
    const students: WeekGridStudent[] = [
      ...members.map((m) => ({
        _id: m._id,
        fullName: m.fullName,
        username: m.username,
      })),
      ...manualDocs.map((d) => ({
        _id: String(d._id),
        fullName: d.fullName,
        username: usernameByName.get(normaliseName(d.fullName)),
        isManual: true,
      })),
    ].sort(bySurname);

    // Marks for this week
    const records = await this.records
      .find({
        groupId: new Types.ObjectId(groupId),
        date: { $gte: start, $lt: end },
      })
      .lean()
      .exec();

    const marks: WeekGridMark[] = [];
    const perStudentWeek: Record<string, { absent: number; excused: number; late: number }> = {};
    const perLessonWeek: Record<
      string,
      { present: number; absent: number; excused: number; late: number }
    > = {};
    for (const r of records) {
      const lessonId = String(r.scheduleLessonId);
      perLessonWeek[lessonId] ??= { present: 0, absent: 0, excused: 0, late: 0 };
      for (const e of r.entries) {
        const studentId = String(e.userId);
        marks.push({
          studentId,
          lessonId,
          date: r.date.toISOString(),
          status: e.status,
        });
        if (e.status === AttendanceStatus.Absent) {
          perStudentWeek[studentId] ??= { absent: 0, excused: 0, late: 0 };
          perStudentWeek[studentId].absent += 1;
          perLessonWeek[lessonId].absent += 1;
        } else if (e.status === AttendanceStatus.Excused) {
          perStudentWeek[studentId] ??= { absent: 0, excused: 0, late: 0 };
          perStudentWeek[studentId].excused += 1;
          perLessonWeek[lessonId].excused += 1;
        } else if (e.status === AttendanceStatus.Late) {
          perStudentWeek[studentId] ??= { absent: 0, excused: 0, late: 0 };
          perStudentWeek[studentId].late += 1;
          perLessonWeek[lessonId].late += 1;
        } else if (e.status === AttendanceStatus.Present) {
          perLessonWeek[lessonId].present += 1;
        }
      }
    }

    // Cumulative totals (all records up to and including this week)
    const totalAgg = await this.records.aggregate<{
      _id: { userId: Types.ObjectId; status: string };
      count: number;
    }>([
      { $match: { groupId: new Types.ObjectId(groupId), date: { $lt: end } } },
      { $unwind: '$entries' },
      {
        $group: {
          _id: { userId: '$entries.userId', status: '$entries.status' },
          count: { $sum: 1 },
        },
      },
    ]);
    const perStudentTotal: Record<string, { absent: number; excused: number; late: number }> = {};
    for (const row of totalAgg) {
      const sid = String(row._id.userId);
      perStudentTotal[sid] ??= { absent: 0, excused: 0, late: 0 };
      if (row._id.status === AttendanceStatus.Absent) perStudentTotal[sid].absent = row.count;
      else if (row._id.status === AttendanceStatus.Excused) perStudentTotal[sid].excused = row.count;
      else if (row._id.status === AttendanceStatus.Late) perStudentTotal[sid].late = row.count;
    }

    return {
      weekStart: start.toISOString(),
      weekType,
      lessons,
      students,
      marks,
      perStudentWeek,
      perStudentTotal,
      perLessonWeek,
    };
  }

  async upsertEntry(
    user: RequestUser,
    groupId: string,
    params: {
      scheduleLessonId: string;
      date: Date;
      userId: string;
      status: AttendanceStatus;
      note?: string;
    },
    opts?: { allowSubjectTeacherAccess?: boolean },
  ): Promise<void> {
    const subjectTeacherOnly = this.assertCanManage(
      user,
      groupId,
      opts?.allowSubjectTeacherAccess ?? false,
    );
    const day = new Date(params.date);
    day.setUTCHours(0, 0, 0, 0);
    await this.assertTargets(user, groupId, params.scheduleLessonId, day, [params.userId], subjectTeacherOnly);

    const filter = {
      groupId: new Types.ObjectId(groupId),
      scheduleLessonId: new Types.ObjectId(params.scheduleLessonId),
      date: day,
    };
    const userObjectId = new Types.ObjectId(params.userId);
    // Atomic updates instead of findOne → create/save: concurrent marks on the
    // same lesson-day used to hit E11000 (double create) or VersionError.
    await retryOnDuplicate(async () => {
      const res = await this.records.updateOne(
        { ...filter, 'entries.userId': userObjectId },
        // Missing note clears the old one, as the previous save() did.
        params.note !== undefined
          ? { $set: { 'entries.$.status': params.status, 'entries.$.note': params.note } }
          : { $set: { 'entries.$.status': params.status }, $unset: { 'entries.$.note': 1 } },
      );
      if (res.matchedCount > 0) return;
      // No entry for this user yet (or no record at all) → push, creating the
      // record if needed. A concurrent insert surfaces as E11000 → retried once.
      await this.records.updateOne(
        { ...filter, 'entries.userId': { $ne: userObjectId } },
        {
          $push: { entries: { userId: userObjectId, status: params.status, note: params.note } },
          $setOnInsert: { createdBy: new Types.ObjectId(user.userId) },
        },
        { upsert: true },
      );
    });
  }

  async getUserWeek(
    groupId: string,
    userId: string,
    weekStart?: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const start = weekStart ? new Date(weekStart) : mondayOf(new Date());
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const records = await this.records
      .find({ groupId: new Types.ObjectId(groupId), date: { $gte: start, $lt: end } })
      .populate<{ scheduleLessonId: ScheduleLessonDocument | null }>('scheduleLessonId')
      .exec();

    return records.map((r) => {
      const entry = r.entries.find((e) => String(e.userId) === userId);
      const lesson = r.scheduleLessonId as unknown as ScheduleLessonDocument | null;
      return {
        lessonId: lesson ? String(lesson._id) : '',
        subjectName: lesson?.subjectName ?? '',
        startTime: lesson?.startTime ?? '',
        dayOfWeek: lesson?.dayOfWeek ?? 0,
        date: r.date,
        status: entry?.status ?? 'unknown',
      };
    });
  }

  async upsert(user: RequestUser, groupId: string, dto: UpsertAttendanceDto): Promise<AttendanceRecordDocument> {
    this.assertCanManage(user, groupId);
    const date = new Date(dto.date);
    date.setUTCHours(0, 0, 0, 0);
    await this.assertTargets(
      user,
      groupId,
      dto.scheduleLessonId,
      date,
      dto.entries.map((e) => e.userId),
      false,
    );

    const entries = dto.entries.map((e) => ({
      userId: new Types.ObjectId(e.userId),
      status: e.status,
      note: e.note,
    }));
    // Single atomic upsert (was findOne → save/create, which raced into E11000).
    const record = await retryOnDuplicate(() =>
      this.records
        .findOneAndUpdate(
          {
            groupId: new Types.ObjectId(groupId),
            scheduleLessonId: new Types.ObjectId(dto.scheduleLessonId),
            date,
          },
          { $set: { entries }, $setOnInsert: { createdBy: new Types.ObjectId(user.userId) } },
          { upsert: true, new: true, runValidators: true },
        )
        .exec(),
    );
    return record!;
  }

  async getLessonRecord(
    groupId: string,
    lessonId: string,
    date: Date,
  ): Promise<{ entries: Array<{ userId: string; status: string; note?: string }> }> {
    if (!Types.ObjectId.isValid(lessonId)) return { entries: [] };
    const day = new Date(date);
    day.setUTCHours(0, 0, 0, 0);
    const record = await this.records
      .findOne({
        groupId: new Types.ObjectId(groupId),
        scheduleLessonId: new Types.ObjectId(lessonId),
        date: day,
      })
      .lean()
      .exec();
    if (!record) return { entries: [] };
    return {
      entries: record.entries.map((e) => ({
        userId: String(e.userId),
        status: e.status,
        note: e.note,
      })),
    };
  }

  async getWeek(groupId: string, weekStart: Date): Promise<AttendanceRecordDocument[]> {
    const start = new Date(weekStart);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return this.records
      .find({ groupId: new Types.ObjectId(groupId), date: { $gte: start, $lt: end } })
      .exec();
  }

  async statsForUser(groupId: string, userId: string): Promise<UserAttendanceStats> {
    // :userId comes from the URL; a malformed one made new ObjectId() throw a 500.
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Invalid userId');
    const pipeline = [
      { $match: { groupId: new Types.ObjectId(groupId) } },
      { $unwind: '$entries' },
      { $match: { 'entries.userId': new Types.ObjectId(userId) } },
      {
        $group: {
          _id: '$entries.status',
          count: { $sum: 1 },
          lastWeek: {
            $sum: {
              $cond: [
                { $gte: ['$date', new Date(Date.now() - 7 * 86400000)] },
                1,
                0,
              ],
            },
          },
        },
      },
    ];
    const rows = await this.records.aggregate(pipeline).exec();
    const stats: UserAttendanceStats = {
      userId,
      totalLessons: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    };
    for (const r of rows) {
      stats.totalLessons += r.count;
      if (r._id === AttendanceStatus.Absent) stats.absent = r.count;
      if (r._id === AttendanceStatus.Excused) stats.excused = r.count;
      if (r._id === AttendanceStatus.Present) stats.present = r.count;
      if (r._id === AttendanceStatus.Late) stats.late = r.count;
    }
    return stats;
  }

  /**
   * 403 unless the user has a journal role in the group. Returns true when
   * they pass only as a subject teacher (controller-verified ?subjectIds).
   */
  private assertCanManage(user: RequestUser, groupId: string, allowSubjectTeacherAccess = false): boolean {
    const m = user.memberships.find((x) => x.groupId === groupId);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    // Teachers (level 2) can mark attendance for their lessons;
    // deputy/head (level 3+) can do everything including student list management.
    if (level < ROLE_LEVEL[Role.Teacher] && !allowSubjectTeacherAccess) {
      throw new ForbiddenException('Only teacher/head/deputy can mark attendance');
    }
    return level < ROLE_LEVEL[Role.Teacher];
  }

  /**
   * 400 unless the lesson is this group's and every target is a member, a
   * manual student of the group, or already on this record (the mark page
   * re-sends saved entries). A subject teacher may only mark lessons of a
   * subject they teach here, matched like the journal grid: subjectId or name.
   */
  private async assertTargets(
    user: RequestUser,
    groupId: string,
    lessonId: string,
    day: Date,
    userIds: string[],
    subjectTeacherOnly: boolean,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(lessonId) || !userIds.every((id) => Types.ObjectId.isValid(id))) {
      throw new BadRequestException('Invalid id');
    }
    const gid = new Types.ObjectId(groupId);
    const lesson = await this.lessons
      .findOne({ _id: new Types.ObjectId(lessonId), groupId: gid }, { subjectId: 1, subjectName: 1 })
      .lean()
      .exec();
    if (!lesson) throw new BadRequestException('Lesson is not in this group');

    if (subjectTeacherOnly) {
      // Load the group's subjects and match teachers in JS: String() also
      // matches a teacherUserId stored as a string, like the controller does.
      const subjects = await this.subjects
        .find({ groupId: gid }, { name: 1, shortName: 1, 'teachers.teacherUserId': 1 })
        .lean()
        .exec();
      const lessonName = normaliseName(lesson.subjectName ?? '');
      const ok = subjects.some(
        (s) =>
          s.teachers.some((t) => t.teacherUserId && String(t.teacherUserId) === user.userId) &&
          ((!!lesson.subjectId && String(lesson.subjectId) === String(s._id)) ||
            [s.name, s.shortName].some((n) => !!n && normaliseName(n) === lessonName)),
      );
      if (!ok) throw new ForbiddenException('Можна відмічати лише заняття свого предмета');
    }

    const ids = [...new Set(userIds)];
    const [members, manual] = await Promise.all([
      this.userModel
        .find(
          { _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, 'memberships.groupId': gid },
          { _id: 1 },
        )
        .lean()
        .exec(),
      this.manualStudents.listForGroup(groupId),
    ]);
    const known = new Set([...members, ...manual].map((d) => String(d._id)));
    let missing = ids.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const record = await this.records
      .findOne(
        { groupId: gid, scheduleLessonId: lesson._id, date: day },
        { 'entries.userId': 1 },
      )
      .lean()
      .exec();
    const onRecord = new Set((record?.entries ?? []).map((e) => String(e.userId)));
    missing = missing.filter((id) => !onRecord.has(id));
    if (missing.length > 0) throw new BadRequestException('Student is not in this group');
  }
}

/** Runs `fn`, retrying once on E11000 — a concurrent upsert won the insert of the same record. */
async function retryOnDuplicate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    return fn();
  }
}

function mondayOf(d: Date): Date {
  const r = new Date(d);
  const dow = (r.getUTCDay() + 6) % 7;
  r.setUTCDate(r.getUTCDate() - dow);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

/** "Бурлака Микита Олегович" → "бурлака микита олегович" — for fuzzy matching. */
function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Sort by surname (the first whitespace-separated token), Ukrainian locale. */
function bySurname(a: WeekGridStudent, b: WeekGridStudent): number {
  const sa = a.fullName.trim().split(/\s+/)[0] ?? '';
  const sb = b.fullName.trim().split(/\s+/)[0] ?? '';
  return sa.localeCompare(sb, 'uk');
}
