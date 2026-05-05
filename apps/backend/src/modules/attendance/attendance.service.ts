import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttendanceStatus, Role, ROLE_LEVEL } from '@fice/shared';
import { AttendanceRecord, AttendanceRecordDocument } from './attendance.schema';
import { UpsertAttendanceDto } from './dto/attendance.dto';
import { RequestUser } from '../../common/types/request-user';
import { ScheduleLesson, ScheduleLessonDocument } from '../schedule/schedule.schema';
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
    this.assertCanManage(user, groupId, opts?.allowSubjectTeacherAccess ?? false);
    const day = new Date(params.date);
    day.setUTCHours(0, 0, 0, 0);

    const filter = {
      groupId: new Types.ObjectId(groupId),
      scheduleLessonId: new Types.ObjectId(params.scheduleLessonId),
      date: day,
    };
    const existing = await this.records.findOne(filter);
    const userObjectId = new Types.ObjectId(params.userId);
    if (!existing) {
      await this.records.create({
        ...filter,
        entries: [{ userId: userObjectId, status: params.status, note: params.note }],
        createdBy: new Types.ObjectId(user.userId),
      });
      return;
    }
    const idx = existing.entries.findIndex((e) => String(e.userId) === params.userId);
    if (idx >= 0) {
      existing.entries[idx].status = params.status;
      existing.entries[idx].note = params.note;
    } else {
      existing.entries.push({
        userId: userObjectId,
        status: params.status,
        note: params.note,
      });
    }
    await existing.save();
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

    const existing = await this.records.findOne({
      groupId: new Types.ObjectId(groupId),
      scheduleLessonId: new Types.ObjectId(dto.scheduleLessonId),
      date,
    });

    if (existing) {
      existing.entries = dto.entries.map((e) => ({
        userId: new Types.ObjectId(e.userId),
        status: e.status,
        note: e.note,
      }));
      await existing.save();
      return existing;
    }

    return this.records.create({
      groupId: new Types.ObjectId(groupId),
      scheduleLessonId: new Types.ObjectId(dto.scheduleLessonId),
      date,
      entries: dto.entries.map((e) => ({
        userId: new Types.ObjectId(e.userId),
        status: e.status,
        note: e.note,
      })),
      createdBy: new Types.ObjectId(user.userId),
    });
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

  private assertCanManage(user: RequestUser, groupId: string, allowSubjectTeacherAccess = false): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    // Teachers (level 2) can mark attendance for their lessons;
    // deputy/head (level 3+) can do everything including student list management.
    if (level < ROLE_LEVEL[Role.Teacher] && !allowSubjectTeacherAccess) {
      throw new ForbiddenException('Only teacher/head/deputy can mark attendance');
    }
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
