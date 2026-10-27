import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL, TeacherRoleInSubject } from '@fice/shared';
import type { SubjectLinkReminderType } from '@fice/shared';
import { Subject, SubjectDocument } from './subject.schema';
import { AttendanceSession, AttendanceSessionDocument } from './attendance.schema';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { User, UserDocument } from '../users/user.schema';
import { CreateSubjectDto, SubjectLinkDto, SubjectTeacherDto, UpdateSubjectDto } from './dto/subject.dto';
import { SheetsService } from '../sheets/sheets.service';
import { UsersService } from '../users/users.service';
import { CampusService } from '../campus/campus.service';
import { RequestUser } from '../../common/types/request-user';

@Injectable()
export class SubjectsService {
  private readonly logger = new Logger(SubjectsService.name);

  constructor(
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @InjectModel(AttendanceSession.name) private readonly attendance: Model<AttendanceSessionDocument>,
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly sheets: SheetsService,
    private readonly usersService: UsersService,
    private readonly campus: CampusService,
  ) {}

  async create(user: RequestUser, dto: CreateSubjectDto): Promise<SubjectDocument> {
    this.assertCanManageGroup(user, dto.groupId);
    const teachers = await this.enrichTeachers(dto.teachers);
    const subject = await this.subjects.create({
      groupId: new Types.ObjectId(dto.groupId),
      name: dto.name,
      shortName: dto.shortName,
      icon: dto.icon?.trim() || undefined,
      isOnline: dto.isOnline,
      campusSubjectId: dto.campusSubjectId,
      teachers,
      links: this.normalizeLinks(dto.links),
      createdBy: new Types.ObjectId(user.userId),
    });
    // Grant 'teacher' membership to any linked user accounts so they can access
    // the journal and schedule without having to re-login.
    await this.grantTeacherMemberships(teachers, dto.groupId);
    return subject;
  }

  async list(groupId: string): Promise<Array<Subject & { _id: Types.ObjectId }>> {
    return this.subjects
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ name: 1 })
      .lean()
      .exec();
  }

  async findById(id: string): Promise<SubjectDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Subject not found');
    const subject = await this.subjects.findById(id).exec();
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  async findOneForUser(user: RequestUser, id: string): Promise<Record<string, unknown>> {
    const subject = await this.findById(id);
    const groupIdStr = String(subject.groupId);
    const m = user.memberships.find((x) => x.groupId === groupIdStr);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    const canManage = level >= ROLE_LEVEL[Role.DeputyHead];
    // A user is treated as a "teacher of this subject" if either:
    //   (a) they have a teacher-level membership in the group, OR
    //   (b) their account is linked in subject.teachers (`teacherUserId`) —
    //       Campus-identified teachers who never joined the group.
    const isInSubjectTeachers = this.hasTeacherAccessForSubject(user, subject);
    const isTeacher =
      (level >= ROLE_LEVEL[Role.Teacher] && level < ROLE_LEVEL[Role.DeputyHead]) ||
      (isInSubjectTeachers && !canManage);
    // One batched lookup for linked teachers' avatars (not per teacher).
    const teacherUserIds = subject.teachers.flatMap((t) => (t.teacherUserId ? [t.teacherUserId] : []));
    const avatars = teacherUserIds.length
      ? await this.users.find({ _id: { $in: teacherUserIds } }, { avatarUrl: 1 }).lean().exec()
      : [];
    const avatarOf = new Map(avatars.map((u) => [String(u._id), u.avatarUrl]));
    return {
      _id: String(subject._id),
      groupId: groupIdStr,
      name: subject.name,
      shortName: subject.shortName,
      icon: subject.icon,
      isOnline: subject.isOnline,
      campusSubjectId: subject.campusSubjectId,
      teachers: subject.teachers.map((t) => ({
        teacherUserId: t.teacherUserId ? String(t.teacherUserId) : undefined,
        fullName: t.fullName,
        telegramUsername: t.telegramUsername,
        role: t.role,
        externalSource: t.externalSource,
        roleInSubject: t.role,
        avatarUrl: t.teacherUserId ? avatarOf.get(String(t.teacherUserId)) : undefined,
      })),
      links: subject.links.map((l) => ({
        label: l.label,
        url: l.url,
        teacherUserId: l.teacherUserId ? String(l.teacherUserId) : undefined,
        showInLessonReminder: l.showInLessonReminder,
        lessonReminderType: l.lessonReminderType,
      })),
      visibility: {
        homeworkVisible: !subject.settings.hideHomework,
        queueVisible: !subject.settings.hideQueue,
        linksVisible: !subject.settings.hideLinks,
        teachersVisible: !subject.settings.hideTeachers,
      },
      canManage,
      isTeacher,
    };
  }

  async update(user: RequestUser, id: string, dto: UpdateSubjectDto): Promise<SubjectDocument> {
    const subject = await this.findById(id);
    const groupIdStr = String(subject.groupId);
    this.assertCanManageGroup(user, groupIdStr);

    if (dto.name !== undefined) subject.name = dto.name;
    if (dto.shortName !== undefined) {
      const trimmed = dto.shortName?.trim();
      subject.shortName = trimmed ? trimmed : undefined;
    }
    if (dto.icon !== undefined) subject.icon = dto.icon.trim() || undefined;
    if (dto.isOnline !== undefined) subject.isOnline = dto.isOnline;
    if (dto.teachers) {
      subject.teachers = await this.enrichTeachers(dto.teachers);
      subject.markModified('teachers');
    }
    if (dto.links) {
      subject.links = this.normalizeLinks(dto.links);
      subject.markModified('links');
    }
    if (dto.settings) Object.assign(subject.settings, dto.settings);

    await subject.save();
    // If teachers were updated, ensure any linked user accounts have 'teacher' membership.
    if (dto.teachers) await this.grantTeacherMemberships(subject.teachers, groupIdStr);
    return subject;
  }

  async remove(user: RequestUser, id: string): Promise<void> {
    const subject = await this.findById(id);
    this.assertCanManageGroup(user, String(subject.groupId));
    await this.subjects.deleteOne({ _id: subject._id });
  }

  /**
   * Update only the useful-links list — accessible to teachers (Teacher level
   * or referenced in subject.teachers). The wider `update()` is reserved for
   * head/deputy because it can also rewrite the teacher list and visibility.
   */
  async updateLinks(
    user: RequestUser,
    subjectId: string,
    links: SubjectLinkDto[],
  ): Promise<SubjectDocument> {
    const subject = await this.findById(subjectId);
    const groupIdStr = String(subject.groupId);
    this.assertTeacherAccessForSubject(user, subject);
    const cleaned = this.normalizeLinks(links);
    subject.links = cleaned;
    subject.markModified('links');
    await subject.save();
    this.logger.log(
      `Links updated on subject ${subjectId} by ${user.userId} (group ${groupIdStr}, ${cleaned.length} links)`,
    );
    return subject;
  }

  /**
   * Suggest teachers from the Campus group schedule for a specific (group,
   * subjectName) pair. Returns one entry per teacher with all roles they
   * have on this subject in this group (Лектор/Практика/Лаборант) — so the
   * head sees a checklist of pre-filled choices instead of typing names.
   */
  async suggestTeachersFromCampus(
    groupId: string,
    subjectName: string,
  ): Promise<
    Array<{
      fullName: string;
      telegramUsername?: string;
      roles: TeacherRoleInSubject[];
    }>
  > {
    if (!Types.ObjectId.isValid(groupId)) return [];
    const group = await this.groups.findById(groupId).lean().exec();
    if (!group?.campusGroupId) return [];

    const lessons = await this.campus.getGroupSchedule(group.campusGroupId);
    const needle = normaliseStr(subjectName);
    const matches = lessons.filter((l) => normaliseStr(l.subjectName) === needle);
    if (matches.length === 0) return [];

    const TYPE_TO_ROLE: Record<string, TeacherRoleInSubject> = {
      lecture: TeacherRoleInSubject.Lecturer,
      practice: TeacherRoleInSubject.Practice,
      lab: TeacherRoleInSubject.Lab,
    };

    // teacherName → set of roles
    const byTeacher = new Map<string, Set<TeacherRoleInSubject>>();
    for (const l of matches) {
      const role = TYPE_TO_ROLE[l.type];
      if (!role) continue;
      for (const name of l.teacherNames) {
        const trimmed = name.trim();
        if (!trimmed) continue;
        const set = byTeacher.get(trimmed) ?? new Set<TeacherRoleInSubject>();
        set.add(role);
        byTeacher.set(trimmed, set);
      }
    }

    // Enrich with sheet @username when available.
    const sheetTeachers = await this.sheets.getTeachers().catch(() => []);
    const sheetByName = new Map<string, string | undefined>();
    for (const t of sheetTeachers) {
      sheetByName.set(t.fullName.trim().toLowerCase(), t.telegramUsername);
    }

    return [...byTeacher.entries()]
      .map(([fullName, roles]) => ({
        fullName,
        telegramUsername: sheetByName.get(fullName.toLowerCase()),
        roles: orderRoles([...roles]),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk'));
  }

  private async enrichTeachers(list: SubjectTeacherDto[]): Promise<Subject['teachers']> {
    const out: Subject['teachers'] = [];
    // Dedupe by (teacherUserId || username || fullName) + role — same teacher
    // with the same role added twice is a bug, not a feature.
    const seen = new Set<string>();
    for (const t of list) {
      const fromSheet = await this.sheets.findTeacherByName(t.fullName).catch(() => undefined);
      const username = t.telegramUsername ?? fromSheet?.telegramUsername;
      const key = (t.teacherUserId ?? username ?? t.fullName).toLowerCase().trim() + '|' + t.role;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        teacherUserId: t.teacherUserId ? new Types.ObjectId(t.teacherUserId) : undefined,
        fullName: t.fullName,
        telegramUsername: username,
        role: t.role,
        externalSource: fromSheet ? 'sheet' : 'manual',
      });
    }
    return out;
  }

  private normalizeLinks(links: SubjectLinkDto[] | undefined): Subject['links'] {
    return (links ?? [])
      .map<Subject['links'][number] | null>((l) => {
        const label = String(l.label ?? '').trim();
        const url = String(l.url ?? '').trim();
        if (!label || !url) return null;
        const showInLessonReminder = Boolean(l.showInLessonReminder);
        const lessonReminderType = showInLessonReminder
          ? this.normalizeLessonReminderType(l.lessonReminderType) ?? 'lecture'
          : undefined;
        return {
          label,
          url,
          teacherUserId: l.teacherUserId ? new Types.ObjectId(l.teacherUserId) : undefined,
          showInLessonReminder,
          lessonReminderType,
        };
      })
      .filter((l): l is Subject['links'][number] => l !== null)
      .slice(0, 30);
  }

  private normalizeLessonReminderType(
    type?: SubjectLinkReminderType,
  ): SubjectLinkReminderType | undefined {
    if (type === 'lecture' || type === 'practice' || type === 'lab') return type;
    return undefined;
  }

  /**
   * For every teacher slot that has a real `teacherUserId` set, ensure that
   * user has at least a `teacher` membership in the group. This lets teachers
   * view the journal and schedule as soon as the head links their account —
   * no re-login needed (the auth guard reads memberships fresh from DB).
   */
  private async grantTeacherMemberships(
    teachers: Subject['teachers'],
    groupId: string,
  ): Promise<void> {
    for (const t of teachers) {
      if (!t.teacherUserId) continue;
      try {
        await this.usersService.ensureMembership(String(t.teacherUserId), groupId, Role.Teacher);
      } catch (err) {
        this.logger.warn(
          `Could not grant teacher membership to ${t.teacherUserId}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ── Students list ─────────────────────────────────────────────────────────

  async getGroupStudents(user: RequestUser, subjectId: string) {
    const subject = await this.findById(subjectId);
    const groupIdStr = String(subject.groupId);
    this.assertTeacherAccessForSubject(user, subject);
    const members = await this.usersService.listGroupStudents(groupIdStr);
    return members.map((u) => ({
      _id: String(u._id),
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: u.fullName,
      username: u.username,
      telegramId: u.telegramId,
      avatarUrl: u.avatarUrl,
    }));
  }

  // ── Attendance journal ─────────────────────────────────────────────────────

  /** List all attendance sessions for a subject (most recent first). */
  async listJournalSessions(user: RequestUser, subjectId: string) {
    const subject = await this.findById(subjectId);
    const groupIdStr = String(subject.groupId);
    this.assertTeacherAccessForSubject(user, subject);
    const sessions = await this.attendance
      .find({ subjectId: new Types.ObjectId(subjectId) })
      .sort({ date: -1 })
      .lean()
      .exec();
    return sessions.map((s) => ({
      _id: String(s._id),
      date: s.date,
      lessonNumber: s.lessonNumber,
      note: s.note,
      presentCount: s.presentStudentIds.length,
    }));
  }

  /** Get a single session with full student name list. */
  async getJournalSession(user: RequestUser, subjectId: string, sessionId: string) {
    const subject = await this.findById(subjectId);
    const groupIdStr = String(subject.groupId);
    this.assertTeacherAccessForSubject(user, subject);

    const session = await this.attendance.findById(sessionId).lean().exec();
    if (!session || String(session.subjectId) !== subjectId) {
      throw new NotFoundException('Session not found');
    }

    const allStudents = await this.usersService.listGroupStudents(groupIdStr);
    const presentSet = new Set(session.presentStudentIds.map(String));

    return {
      _id: String(session._id),
      date: session.date,
      lessonNumber: session.lessonNumber,
      note: session.note,
      students: allStudents.map((u) => ({
        _id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        fullName: u.fullName,
        username: u.username,
        present: presentSet.has(String(u._id)),
      })),
    };
  }

  /** Create a new attendance session. */
  async createJournalSession(
    user: RequestUser,
    subjectId: string,
    dto: { date: string; lessonNumber?: number; note?: string; presentStudentIds: string[] },
  ) {
    const subject = await this.findById(subjectId);
    const groupIdStr = String(subject.groupId);
    this.assertTeacherAccessForSubject(user, subject);
    const session = await this.attendance.create({
      subjectId: new Types.ObjectId(subjectId),
      teacherUserId: new Types.ObjectId(user.userId),
      date: new Date(dto.date),
      lessonNumber: dto.lessonNumber,
      note: dto.note,
      presentStudentIds: await this.groupMemberIds(groupIdStr, dto.presentStudentIds),
    });
    return { _id: String(session._id), date: session.date, presentCount: session.presentStudentIds.length };
  }

  /** Update attendance in an existing session. */
  async updateJournalSession(
    user: RequestUser,
    subjectId: string,
    sessionId: string,
    dto: { note?: string; presentStudentIds?: string[] },
  ) {
    const subject = await this.findById(subjectId);
    const groupIdStr = String(subject.groupId);
    this.assertTeacherAccessForSubject(user, subject);

    const update: Record<string, unknown> = {};
    if (dto.note !== undefined) update.note = dto.note;
    if (dto.presentStudentIds) {
      update.presentStudentIds = await this.groupMemberIds(groupIdStr, dto.presentStudentIds);
    }
    await this.attendance.updateOne({ _id: sessionId, subjectId: new Types.ObjectId(subjectId) }, { $set: update });
    return { ok: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Teacher-level membership in the subject's group (teacher, deputy, head,
   * admin) or an account linked in `subject.teachers` — covers Campus-only
   * teachers who never joined the group.
   */
  private assertTeacherAccessForSubject(user: RequestUser, subject: SubjectDocument): void {
    if (!this.hasTeacherAccessForSubject(user, subject)) {
      throw new ForbiddenException('Доступ заборонено: ви не викладач цього предмета.');
    }
  }

  private hasTeacherAccessForSubject(user: RequestUser, subject: SubjectDocument): boolean {
    const groupId = String(subject.groupId);
    if (user.memberships.some((m) => m.groupId === groupId && ROLE_LEVEL[m.role] >= ROLE_LEVEL[Role.Teacher])) {
      return true;
    }
    // Only the account link authorizes: fullName is user-editable (PATCH /users/me)
    // and teacher names are public, so name/@username matching let anyone in.
    return subject.teachers.some((t) => !!t.teacherUserId && String(t.teacherUserId) === user.userId);
  }

  /** `ids` as ObjectIds; 400 if any isn't a member of the group (the journal lists exactly them). */
  private async groupMemberIds(groupId: string, ids: string[]): Promise<Types.ObjectId[]> {
    const members = new Map(
      (await this.usersService.listGroupStudents(groupId)).map((u) => [String(u._id), u._id]),
    );
    const out = ids.map((id) => members.get(String(id)));
    if (out.some((id) => !id)) {
      throw new BadRequestException('Студент не належить до групи цього предмета');
    }
    return [...new Set(out as Types.ObjectId[])];
  }

  private assertCanManageGroup(user: RequestUser, groupId: string): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    if (!m || (ROLE_LEVEL[m.role] ?? 0) < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException('Only head or deputy can manage subjects');
    }
  }
}

/** Lowercase + trim + collapse whitespace for case-insensitive subject matching. */
function normaliseStr(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Stable Lecturer → Practice → Lab order so chips render consistently. */
function orderRoles(roles: TeacherRoleInSubject[]): TeacherRoleInSubject[] {
  const order: Record<TeacherRoleInSubject, number> = {
    [TeacherRoleInSubject.Lecturer]: 0,
    [TeacherRoleInSubject.Practice]: 1,
    [TeacherRoleInSubject.Lab]: 2,
  };
  return [...new Set(roles)].sort((a, b) => order[a] - order[b]);
}
