import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL, TeacherRoleInSubject } from '@fice/shared';
import { TeacherApplication, TeacherApplicationDocument } from './teacher-application.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { User, UserDocument } from '../users/user.schema';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { Homework, HomeworkDocument } from '../homework/homework.schema';
import { ManualStudent, ManualStudentDocument } from '../manual-students/manual-student.schema';
import { RequestUser } from '../../common/types/request-user';
import { ApplyTeacherDto, GroupJoinRequestDto, IdentifyTeacherDto, InviteTeacherDto } from './dto/teacher.dto';
import { BotService } from '../bot/bot.service';
import { CampusService } from '../campus/campus.service';
import { SheetsService } from '../sheets/sheets.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class TeachersService implements OnModuleInit {
  private readonly logger = new Logger(TeachersService.name);

  constructor(
    @InjectModel(TeacherApplication.name) private readonly apps: Model<TeacherApplicationDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    @InjectModel(Homework.name) private readonly homework: Model<HomeworkDocument>,
    @InjectModel(ManualStudent.name) private readonly manualStudents: Model<ManualStudentDocument>,
    @Inject(forwardRef(() => BotService)) private readonly bot: BotService,
    private readonly campus: CampusService,
    private readonly sheets: SheetsService,
    private readonly usersService: UsersService,
  ) {}

  onModuleInit(): void {
    const bot = this.bot.getBot();
    if (!bot) return; // bot disabled (no token)

    // Handle inline-keyboard button presses from the join-request notification.
    // Pattern: tjoin:approve:<appId> | tjoin:reject:<appId>
    bot.callbackQuery(/^tjoin:(approve|reject):([a-f0-9]{24})$/, async (ctx) => {
      const action = ctx.match[1] as 'approve' | 'reject';
      const appId = ctx.match[2];
      const from = ctx.from;

      try {
        // Look up the approver in our DB
        const dbUser = await this.users.findOne({ telegramId: from.id }).lean().exec();
        if (!dbUser) {
          await ctx.answerCallbackQuery({ text: 'Вашого акаунту не знайдено.', show_alert: true });
          return;
        }

        const requestUser: RequestUser = {
          userId: String(dbUser._id),
          telegramId: dbUser.telegramId,
          memberships: (dbUser.memberships ?? []).map((m) => ({
            groupId: String(m.groupId),
            role: m.role,
          })),
        };

        await this.decide(requestUser, appId, action);

        const label = action === 'approve' ? '✅ Підтверджено' : '❌ Відхилено';
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        await ctx.answerCallbackQuery({ text: label });

        // Append outcome text to the original message
        try {
          const original = ctx.callbackQuery.message?.text ?? '';
          await ctx.editMessageText(
            `${original}\n\n<b>${label}</b> — ${escapeHtml(from.first_name)}`,
            { parse_mode: 'HTML' },
          );
        } catch {
          /* message might be too old to edit — ignore */
        }
      } catch (err) {
        await ctx.answerCallbackQuery({
          text: (err as Error).message ?? 'Помилка',
          show_alert: true,
        });
      }
    });
  }

  // ── Group-level join requests ──────────────────────────────────────────────

  /**
   * Teacher requests access to a group. Sends a bot notification to the group
   * head so they can approve or reject it with one tap.
   */
  async requestGroupAccess(
    user: RequestUser,
    dto: GroupJoinRequestDto,
  ): Promise<TeacherApplicationDocument> {
    const group = await this.groups.findById(dto.groupId).exec();
    if (!group) throw new NotFoundException('Групу не знайдено');

    // Sheet must list a head for this group — otherwise there's nobody who can
    // approve the request (and the staff DB must mirror the sheet 1:1).
    if (this.sheets.isConfigured()) {
      const sheetHeads = await this.sheets.getHeads().catch(() => []);
      const groupNorm = group.academicName.trim().toLowerCase();
      const hasSheetHead = sheetHeads.some(
        (h) => h.groupName.trim().toLowerCase() === groupNorm,
      );
      if (!hasSheetHead) {
        throw new BadRequestException(
          'Цю групу ще не зареєстровано в адміністративній таблиці — ' +
            'попросіть адміністратора додати старосту, тоді можна надсилати запит.',
        );
      }
    }

    // Idempotent: refuse if a pending request already exists
    const existing = await this.apps.findOne({
      teacherUserId: new Types.ObjectId(user.userId),
      groupId: new Types.ObjectId(dto.groupId),
      status: 'pending',
    });
    if (existing) throw new BadRequestException('Запит вже надіслано — очікуйте відповіді.');

    // Also refuse if they're already a member
    const dbUser = await this.users.findById(user.userId).lean().exec();
    const alreadyMember = (dbUser?.memberships ?? []).some(
      (m) => String(m.groupId) === dto.groupId,
    );
    if (alreadyMember) throw new BadRequestException('Ви вже є учасником цієї групи.');

    const app = await this.apps.create({
      teacherUserId: new Types.ObjectId(user.userId),
      groupId: new Types.ObjectId(dto.groupId),
      note: dto.note,
    });

    // Fire-and-forget bot notification to the group head
    void this.notifyHeadAboutJoinRequest(user, group, String(app._id), dto.note).catch((err) =>
      this.logger.warn(`Failed to notify head about join request: ${(err as Error).message}`),
    );

    return app;
  }

  /** List this user's own group join requests. */
  async myJoinRequests(userId: string): Promise<
    Array<{ _id: string; groupId: string; groupName: string; status: string; note?: string; createdAt?: Date }>
  > {
    const apps = await this.apps
      .find({ teacherUserId: new Types.ObjectId(userId), groupId: { $exists: true } })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!apps.length) return [];
    const groupIds = apps.map((a) => a.groupId).filter(Boolean);
    const groups = await this.groups.find({ _id: { $in: groupIds } }).lean().exec();
    const groupName = new Map(groups.map((g) => [String(g._id), g.academicName]));
    return apps.map((a) => ({
      _id: String(a._id),
      groupId: String(a.groupId),
      groupName: groupName.get(String(a.groupId)) ?? '—',
      status: a.status,
      note: a.note,
      createdAt: (a as any).createdAt,
    }));
  }

  /** Head/deputy lists pending join requests for their group. */
  async listGroupJoinRequests(
    user: RequestUser,
    groupId: string,
  ): Promise<
    Array<{ _id: string; teacherUserId: string; fullName: string; username?: string; note?: string; createdAt?: Date }>
  > {
    const membership = user.memberships.find((m) => m.groupId === groupId);
    if (!membership || ROLE_LEVEL[membership.role] < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException('Тільки старости або заступники можуть переглядати запити.');
    }
    const apps = await this.apps
      .find({ groupId: new Types.ObjectId(groupId), status: 'pending' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    if (!apps.length) return [];
    const teacherIds = apps.map((a) => a.teacherUserId);
    const teachers = await this.users.find({ _id: { $in: teacherIds } }).lean().exec();
    const byId = new Map(teachers.map((u) => [String(u._id), u]));
    return apps.map((a) => {
      const u = byId.get(String(a.teacherUserId));
      const fullName =
        u?.fullName?.trim() ||
        [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() ||
        u?.username ||
        'Невідомо';
      return {
        _id: String(a._id),
        teacherUserId: String(a.teacherUserId),
        fullName,
        username: u?.username,
        note: a.note,
        createdAt: (a as any).createdAt,
      };
    });
  }

  // ── Subject-level applications ─────────────────────────────────────────────

  async apply(user: RequestUser, dto: ApplyTeacherDto): Promise<TeacherApplicationDocument> {
    const subject = await this.subjects.findById(dto.subjectId).exec();
    if (!subject) throw new NotFoundException('Subject not found');
    const existing = await this.apps.findOne({
      teacherUserId: new Types.ObjectId(user.userId),
      subjectId: subject._id,
      status: 'pending',
    });
    if (existing) throw new BadRequestException('Application already pending');
    return this.apps.create({
      teacherUserId: new Types.ObjectId(user.userId),
      subjectId: subject._id,
      note: dto.note,
    });
  }

  async invite(user: RequestUser, dto: InviteTeacherDto): Promise<TeacherApplicationDocument> {
    const subject = await this.subjects.findById(dto.subjectId).exec();
    if (!subject) throw new NotFoundException('Subject not found');
    this.assertCanManage(user, String(subject.groupId));
    const target = await this.users.findById(dto.teacherUserId).exec();
    if (!target) throw new NotFoundException('User not found');
    return this.apps.create({
      teacherUserId: target._id,
      subjectId: subject._id,
      status: 'approved',
      decidedBy: new Types.ObjectId(user.userId),
    });
  }

  async decide(user: RequestUser, appId: string, action: 'approve' | 'reject'): Promise<void> {
    const app = await this.apps.findById(appId).exec();
    if (!app) throw new NotFoundException('Application not found');

    // Determine which group this application is for
    let targetGroupId: Types.ObjectId;
    if (app.groupId) {
      // Group-level join request
      targetGroupId = app.groupId;
    } else if (app.subjectId) {
      // Subject-level application
      const subject = await this.subjects.findById(app.subjectId).exec();
      if (!subject) throw new NotFoundException('Subject not found');
      targetGroupId = subject.groupId as Types.ObjectId;
    } else {
      throw new BadRequestException('Application has no group or subject');
    }

    this.assertCanManage(user, String(targetGroupId));
    if (app.status !== 'pending') throw new BadRequestException('Already decided');

    app.status = action === 'approve' ? 'approved' : 'rejected';
    app.decidedBy = new Types.ObjectId(user.userId);
    await app.save();

    if (action === 'approve') {
      // Grant teacher membership, upgrade-only: approving a (subject) application
      // from a head/deputy of this group must not demote them to teacher.
      await this.usersService.ensureMembership(
        String(app.teacherUserId),
        String(targetGroupId),
        Role.Teacher,
      );

      // Notify the teacher via bot DM
      const teacher = await this.users.findById(app.teacherUserId).lean().exec();
      const group = await this.groups.findById(targetGroupId).lean().exec();
      if (teacher?.telegramId && group) {
        void this.bot
          .sendMessage(
            teacher.telegramId,
            `✅ Ваш запит на доступ до групи <b>${escapeHtml(group.academicName)}</b> схвалено!\n\nВідкрийте FICE Helper, щоб переглядати чергу та журнал.`,
          )
          .catch(() => undefined);
      }
    } else {
      // Notify the teacher about rejection
      const teacher = await this.users.findById(app.teacherUserId).lean().exec();
      const group = await this.groups.findById(targetGroupId).lean().exec();
      if (teacher?.telegramId && group) {
        void this.bot
          .sendMessage(
            teacher.telegramId,
            `❌ Ваш запит на доступ до групи <b>${escapeHtml(group.academicName)}</b> відхилено.`,
          )
          .catch(() => undefined);
      }
    }
  }

  /**
   * Returns all groups this teacher teaches in, with the subjects they're
   * assigned to in each group. Used by the teacher-specific home page.
   */
  async getMyGroups(userId: string): Promise<
    Array<{
      groupId: string;
      groupName: string;
      subjects: Array<{ _id: string; name: string; shortName?: string }>;
    }>
  > {
    const mySubjects = await this.subjects
      .find(
        { 'teachers.teacherUserId': new Types.ObjectId(userId) },
        { name: 1, shortName: 1, groupId: 1 },
      )
      .lean()
      .exec();

    const byGroup = new Map<string, typeof mySubjects>();
    for (const s of mySubjects) {
      const key = String(s.groupId);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(s);
    }
    if (!byGroup.size) return [];

    const groupIds = [...byGroup.keys()];
    const groups = await this.groups
      .find({ _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const nameMap = new Map(groups.map((g) => [String(g._id), g.academicName]));

    return groupIds.map((gid) => ({
      groupId: gid,
      groupName: nameMap.get(gid) ?? gid,
      subjects: (byGroup.get(gid) ?? []).map((s) => ({
        _id: String(s._id),
        name: s.name,
        shortName: s.shortName,
      })),
    }));
  }

  // ── Campus identification ──────────────────────────────────────────────────

  /**
   * Try to match this user's full name against the Campus KPI lecturer list.
   * On success, saves `campusLecturerId`, fetches the lecturer's schedule, and
   * auto-links them to any DB subjects whose group + name match.
   */
  async identifyTeacher(
    userId: string,
    dto: IdentifyTeacherDto,
  ): Promise<{
    matched: boolean;
    lecturerId?: string;
    lecturerName?: string;
    linked: number;
    candidates?: Array<{ id: string; name: string }>;
  }> {
    const user = await this.users.findById(userId).lean().exec();
    if (!user) throw new NotFoundException('User not found');

    // Access control: the user's @username must be in the "Викладачі" sheet, and
    // the Campus lecturer they link must carry that row's name (below) — else any
    // roster member could claim any lecturer's groups. Without Sheets there is
    // nothing to verify against, so identification is refused.
    if (!this.sheets.isConfigured()) {
      throw new ForbiddenException(
        'Верифікацію викладачів не налаштовано. Зверніться до адміністратора системи.',
      );
    }
    const username = user.username;
    if (!username) {
      throw new ForbiddenException(
        'Ваш акаунт не має @username у Telegram. Додайте його і спробуйте ще раз.',
      );
    }
    const inSheet = await this.sheets.findTeacherByUsername(username).catch(() => undefined);
    if (!inSheet) {
      throw new ForbiddenException(
        'Ваш Telegram-тег не знайдено серед викладачів. ' +
          'Зверніться до адміністратора системи.',
      );
    }
    const isMe = (l: { name: string }) => sameLecturerName(l.name, inSheet.fullName);

    let lecturer: { id: string; name: string } | null = null;

    if (dto.lecturerId) {
      // User explicitly confirmed a candidate from a previous search
      const all = await this.campus.getLecturers();
      lecturer = all.find((l) => l.id === dto.lecturerId) ?? null;
      if (lecturer && !isMe(lecturer)) {
        throw new ForbiddenException(
          'Цей профіль Кампусу не збігається з вашим ПІБ у таблиці викладачів. ' +
            'Зверніться до адміністратора системи.',
        );
      }
    } else {
      // Auto-match by name
      const name =
        dto.name?.trim() ||
        user.fullName?.trim() ||
        [user.firstName, user.lastName].filter(Boolean).join(' ');
      if (!name) return { matched: false, linked: 0 };

      lecturer = await this.campus.findLecturerByName(name);
      // Someone else's name → no auto-link; candidates are re-checked on confirm.
      if (!lecturer || !isMe(lecturer)) {
        const candidates = await this.campus.searchLecturers(name, 10);
        return { matched: false, linked: 0, candidates };
      }
    }

    if (!lecturer) return { matched: false, linked: 0 };

    // Persist the lecturer ID on the user record. Also save the lecturer's
    // canonical name as `fullName` if the user hasn't set one yet, so the
    // profile / journal screens don't fall back to the Telegram first-name.
    const userUpdate: Record<string, unknown> = { campusLecturerId: lecturer.id };
    if (!user.fullName && lecturer.name) userUpdate.fullName = lecturer.name;
    await this.users.updateOne({ _id: user._id }, { $set: userUpdate });

    // Fetch lecturer's schedule and collect unique (groupName, subjectName) pairs
    const lessons = await this.campus.getLecturerLessons(lecturer.id);
    const pairs = new Map<string, { groupName: string; subjectName: string }>();
    for (const l of lessons) {
      const key = `${normalizeStr(l.groupName)}|${normalizeStr(l.subjectName)}`;
      if (!pairs.has(key)) pairs.set(key, { groupName: l.groupName, subjectName: l.subjectName });
    }

    if (!pairs.size) {
      return { matched: true, lecturerId: lecturer.id, lecturerName: lecturer.name, linked: 0 };
    }

    // Resolve DB groups by academic name
    const groupNames = [...new Set([...pairs.values()].map((p) => p.groupName))];
    const dbGroups = await this.groups
      .find({ academicName: { $in: groupNames } })
      .lean()
      .exec();
    const groupByName = new Map(dbGroups.map((g) => [g.academicName, g]));

    const displayName =
      user.fullName?.trim() ||
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      'Викладач';

    let linked = 0;
    const grantedGroups = new Set<string>();

    for (const { groupName, subjectName } of pairs.values()) {
      const group = groupByName.get(groupName);
      if (!group) continue;

      // Find a DB subject matching the subject name (exact or short-name)
      const normalSubject = normalizeStr(subjectName);
      const dbSubjects = await this.subjects.find({ groupId: group._id }).lean().exec();
      const subject = dbSubjects.find(
        (s) =>
          normalizeStr(s.name) === normalSubject ||
          (s.shortName && normalizeStr(s.shortName) === normalSubject),
      );
      if (!subject) continue;

      // Add to subject.teachers if not already there
      const alreadyIn = (subject.teachers ?? []).some(
        (t) => t.teacherUserId && String(t.teacherUserId) === userId,
      );
      if (!alreadyIn) {
        // $ne guard: a concurrent identify (auto + manual) must not push a duplicate.
        const res = await this.subjects.updateOne(
          { _id: subject._id, 'teachers.teacherUserId': { $ne: new Types.ObjectId(userId) } },
          {
            $push: {
              teachers: {
                teacherUserId: new Types.ObjectId(userId),
                fullName: displayName,
                telegramUsername: user.username,
                role: TeacherRoleInSubject.Lecturer,
                externalSource: 'manual',
              },
            },
          },
        );
        if (res.modifiedCount) linked++;
      }

      // Grant teacher membership in the group (idempotent per group)
      const groupIdStr = String(group._id);
      if (!grantedGroups.has(groupIdStr)) {
        grantedGroups.add(groupIdStr);
        const hasMembership = (user.memberships ?? []).some(
          (m) => String(m.groupId) === groupIdStr,
        );
        if (!hasMembership) {
          // $ne guard: never touch a membership added since `user` was read.
          await this.users.updateOne(
            { _id: user._id, 'memberships.groupId': { $ne: group._id } },
            {
              $push: {
                memberships: { groupId: group._id, role: Role.Teacher, joinedAt: new Date() },
              },
            },
          );
        }
      }
    }

    return { matched: true, lecturerId: lecturer.id, lecturerName: lecturer.name, linked };
  }

  /**
   * Returns all subjects the teacher is linked to, with group context.
   * Used by the teacher-specific home page.
   */
  async getMySubjects(userId: string): Promise<
    Array<{
      _id: string;
      name: string;
      shortName?: string;
      icon?: string;
      groupId: string;
      groupName: string;
      /** Students in the subject's group: app members (non-teacher roles) + students added by hand. */
      groupStudentCount: number;
      /** Homework of this subject that is still due (deadline ahead or none). */
      activeHomework: number;
    }>
  > {
    const mySubjects = await this.subjects
      .find(
        { 'teachers.teacherUserId': new Types.ObjectId(userId) },
        { name: 1, shortName: 1, icon: 1, groupId: 1 },
      )
      .lean()
      .exec();

    if (!mySubjects.length) return [];

    const groupIds = [...new Set(mySubjects.map((s) => String(s.groupId)))];
    const dbGroups = await this.groups
      .find({ _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const groupNameMap = new Map(dbGroups.map((g) => [String(g._id), g.academicName]));

    // Three grouped counts instead of a query per group / subject.
    const gids = groupIds.map((id) => new Types.ObjectId(id));
    const now = new Date();
    const [members, manual, homework] = await Promise.all([
      this.users
        .aggregate<{ _id: Types.ObjectId; n: number }>([
          { $match: { 'memberships.groupId': { $in: gids } } },
          { $unwind: '$memberships' },
          { $match: { 'memberships.groupId': { $in: gids }, 'memberships.role': { $ne: Role.Teacher } } },
          { $group: { _id: '$memberships.groupId', n: { $sum: 1 } } },
        ])
        .exec(),
      this.manualStudents
        .aggregate<{ _id: Types.ObjectId; n: number }>([
          { $match: { groupId: { $in: gids } } },
          { $group: { _id: '$groupId', n: { $sum: 1 } } },
        ])
        .exec(),
      this.homework
        .aggregate<{ _id: Types.ObjectId; n: number }>([
          {
            $match: {
              subjectId: { $in: mySubjects.map((s) => s._id) },
              // teamSize 0 = info-only posts, also hidden from students' lists.
              teamSize: { $ne: 0 },
              $or: [{ deadline: { $gte: now } }, { deadline: null }],
            },
          },
          { $group: { _id: '$subjectId', n: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const count = (rows: Array<{ _id: Types.ObjectId; n: number }>) => new Map(rows.map((r) => [String(r._id), r.n]));
    const memberCount = count(members);
    const manualCount = count(manual);
    const homeworkCount = count(homework);

    return mySubjects.map((s) => ({
      _id: String(s._id),
      name: s.name,
      shortName: s.shortName,
      icon: s.icon,
      groupId: String(s.groupId),
      groupName: groupNameMap.get(String(s.groupId)) ?? String(s.groupId),
      groupStudentCount: (memberCount.get(String(s.groupId)) ?? 0) + (manualCount.get(String(s.groupId)) ?? 0),
      activeHomework: homeworkCount.get(String(s._id)) ?? 0,
    }));
  }

  async listApplications(subjectId: string): Promise<TeacherApplicationDocument[]> {
    return this.apps.find({ subjectId: new Types.ObjectId(subjectId) }).exec();
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async notifyHeadAboutJoinRequest(
    requester: RequestUser,
    group: AcademicGroupDocument,
    appId: string,
    note?: string,
  ): Promise<void> {
    const dbUser = await this.users.findById(requester.userId).lean().exec();
    const name =
      dbUser?.fullName?.trim() ||
      [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(' ').trim() ||
      (dbUser?.username ? `@${dbUser.username}` : 'Викладач');

    const msg =
      `👨‍🏫 <b>Запит на доступ до групи</b>\n\n` +
      `<b>${escapeHtml(name)}</b>${dbUser?.username ? ` (@${dbUser.username})` : ''}` +
      ` хоче приєднатись до групи <b>${escapeHtml(group.academicName)}</b> як викладач.\n` +
      (note ? `\n💬 <i>${escapeHtml(note)}</i>\n` : '') +
      `\nНатисніть кнопку нижче, щоб підтвердити або відхилити.`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Підтвердити', callback_data: `tjoin:approve:${appId}` },
          { text: '❌ Відхилити', callback_data: `tjoin:reject:${appId}` },
        ],
      ],
    };

    // Prefer DM to the group head so the notification doesn't pollute the group chat.
    if (group.headUserId) {
      const head = await this.users.findById(group.headUserId).lean().exec();
      if (head?.telegramId) {
        await this.bot.sendMessage(head.telegramId, msg, { reply_markup: keyboard });
        return;
      }
    }

    // Fallback: post to the bound group chat if we couldn't reach the head directly.
    if (group.telegramChatId) {
      await this.bot.sendMessage(group.telegramChatId, msg, {
        message_thread_id: group.messageThreadId,
        reply_markup: keyboard,
      });
    }
  }

  private assertCanManage(user: RequestUser, groupId: string): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    if (level < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException();
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Every ≥3-char word of the verified sheet name is a word of the Campus name,
 * and there are at least two (surname + name — a bare surname would match every
 * namesake). Normalised like CampusService's normalizePersonName (case, і/ї→и,
 * є/ё→е) plus ґ→г and apostrophe variants (Мар'яна / Мар’яна / Марʼяна).
 */
function sameLecturerName(campusName: string, sheetName: string): boolean {
  const words = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[їі]/g, 'и')
      .replace(/[єё]/g, 'е')
      .replace(/ґ/g, 'г')
      .replace(/['’ʼ`]/g, '')
      .split(/\s+/);
  const campus = new Set(words(campusName));
  const sheet = words(sheetName).filter((w) => w.length >= 3);
  return sheet.length >= 2 && sheet.every((w) => campus.has(w));
}

/** Strip whitespace/dashes and lowercase for loose subject-name matching. */
function normalizeStr(s: string): string {
  return s.trim().toLowerCase().replace(/[-–—\s]+/g, '');
}
