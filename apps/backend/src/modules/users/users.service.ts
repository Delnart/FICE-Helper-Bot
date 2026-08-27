import { forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { User, UserDocument } from './user.schema';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { BotService } from '../bot/bot.service';
import { SheetsService } from '../sheets/sheets.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** How long a `membershipsValidatedAt` timestamp is considered fresh. */
const REVALIDATE_TTL_MS = 60 * 1000; // 1 min

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @Inject(forwardRef(() => BotService))
    private readonly bot: BotService,
    private readonly sheets: SheetsService,
  ) {}

  /**
   * Find or create a User keyed by `telegramId`. Always refreshes the basic
   * profile fields (firstName/lastName/username) from the latest Telegram
   * payload so we don't go stale.
   *
   * If the @username changed since last seen, the previous one is pushed onto
   * `usernameHistory` (capped to 5) so sheet sync doesn't silently revoke a
   * head/teacher who renamed themselves.
   */
  async upsertFromTelegram(params: {
    telegramId: number;
    firstName: string;
    lastName?: string;
    username?: string;
    avatarUrl?: string;
  }): Promise<UserDocument> {
    // Look up first so we can detect username changes.
    const existing = await this.users.findOne({ telegramId: params.telegramId }).exec();

    const newUsername = params.username?.replace(/^@+/, '').toLowerCase() || undefined;
    const oldUsername = existing?.username?.replace(/^@+/, '').toLowerCase() || undefined;

    const update: Record<string, unknown> = {
      firstName: params.firstName,
      lastName: params.lastName,
      username: params.username,
    };
    if (params.avatarUrl) update.avatarUrl = params.avatarUrl;

    // If username changed (and we had one before) — remember the old tag.
    const ops: Record<string, unknown> = { $set: update };
    if (oldUsername && newUsername && oldUsername !== newUsername) {
      ops.$push = {
        usernameHistory: {
          $each: [oldUsername],
          $position: 0,
          $slice: 5, // keep only last 5 tags
        },
      };
      this.logger.log(
        `User tg=${params.telegramId}: username changed @${oldUsername} → @${newUsername}`,
      );
    }

    const user = await this.users.findOneAndUpdate(
      { telegramId: params.telegramId },
      ops,
      { upsert: true, new: true },
    );
    return user as UserDocument;
  }

  /**
   * Ensure a user has membership in a group with at least the given role.
   * If the user already has a higher or equal role — no-op (idempotent).
   * If the user has a lower role (e.g. student → deputy_head) — upgrades it.
   * If the user has no membership yet — adds one.
   */
  async ensureMembership(userId: string, groupId: string, role: Role): Promise<void> {
    const u = await this.users.findById(userId).lean().exec();
    if (!u) return;
    const existing = (u.memberships ?? []).find((m) => String(m.groupId) === groupId);
    if (existing) {
      // Already has a higher or equal role — no change needed.
      if (ROLE_LEVEL[existing.role] >= ROLE_LEVEL[role]) return;
      // Lower role found — upgrade it by replacing the membership.
      await this.users.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $pull: { memberships: { groupId: new Types.ObjectId(groupId) } } },
      );
    }
    await this.users.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $push: {
          memberships: {
            groupId: new Types.ObjectId(groupId),
            role,
            joinedAt: new Date(),
          },
        },
      },
    );
  }

  /**
   * Remove a user's membership from a group (fired when they leave the Telegram
   * chat). Also clears `group.headUserId` and `group.deputyUserIds` if the
   * departing user held one of those roles. Idempotent — safe to call even if
   * the membership doesn't exist.
   */
  async removeMemberFromGroup(telegramId: number, groupId: string): Promise<void> {
    const user = await this.users.findOne({ telegramId }).lean().exec();
    if (!user) return;

    const membership = (user.memberships ?? []).find(
      (m) => String(m.groupId) === groupId,
    );
    if (!membership) return; // already gone — nothing to do

    // Drop the membership
    await this.users.updateOne(
      { _id: user._id },
      { $pull: { memberships: { groupId: new Types.ObjectId(groupId) } } },
    );

    // If they were the group head → clear headUserId
    await this.groups.updateOne(
      { _id: new Types.ObjectId(groupId), headUserId: user._id },
      { $unset: { headUserId: '' } },
    );

    // If they were a deputy → remove from deputyUserIds
    await this.groups.updateOne(
      { _id: new Types.ObjectId(groupId) },
      { $pull: { deputyUserIds: user._id } },
    );

    this.logger.log(
      `Removed @${user.username ?? user.telegramId} from group ${groupId} ` +
      `(left/kicked, was ${membership.role})`,
    );
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.users.findById(id).lean().exec();
    if (!user) throw new NotFoundException('User not found');
    return user as UserDocument;
  }

  async profileFor(id: string): Promise<Record<string, unknown>> {
    const user = await this.users.findById(id).lean().exec();
    if (!user) throw new NotFoundException('User not found');

    // Cross-check memberships against Telegram if the cached check is stale.
    // Fire-and-forget so the current request stays fast — the next /me call
    // (≥ a few seconds later) will see the cleaned-up membership list.
    const validatedAt = (user as { membershipsValidatedAt?: Date }).membershipsValidatedAt;
    const stale = !validatedAt || Date.now() - validatedAt.getTime() > REVALIDATE_TTL_MS;
    if (stale && (user.memberships?.length ?? 0) > 0) {
      void this.bot.revalidateUserMemberships(String(user._id)).catch((err) => {
        this.logger.warn(`background revalidation failed: ${(err as Error).message}`);
      });
    }

    const groupIds = (user.memberships ?? []).map((m) => m.groupId);
    const groups = groupIds.length
      ? await this.groups.find({ _id: { $in: groupIds } }).lean().exec()
      : [];
    const groupName = new Map(groups.map((g) => [String(g._id), g.academicName]));

    const memberships = (user.memberships ?? []).map((m) => ({
      groupId: String(m.groupId),
      role: m.role,
      groupName: groupName.get(String(m.groupId)),
      joinedAt: m.joinedAt,
    }));

    // A user gains access to the app if they:
    //   (a) belong to at least one group, or
    //   (b) are referenced as a teacher inside any subject, or
    //   (c) their @username is in the «Викладачі» sheet (verified teacher),
    //       even before they identify via Campus or get added to subjects.teachers.
    // Everything else sees the "no access" landing page.
    let accessReason: 'member' | 'teacher' | 'none' = 'none';
    if (memberships.length > 0) {
      accessReason = 'member';
    } else {
      const teaching = await this.subjects
        .countDocuments({ 'teachers.teacherUserId': user._id })
        .exec();
      if (teaching > 0) {
        accessReason = 'teacher';
      } else if (user.username && this.sheets.isConfigured()) {
        const inSheet = await this.sheets
          .findTeacherByUsername(user.username)
          .catch(() => undefined);
        if (inSheet) accessReason = 'teacher';
      }
    }

    return {
      _id: String(user._id),
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      fullName: user.fullName,
      birthday: user.birthday,
      memberships,
      accessReason,
      campusLecturerId: user.campusLecturerId,
    };
  }

  async findByTelegramId(telegramId: number): Promise<UserDocument | null> {
    return this.users.findOne({ telegramId }).exec();
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<Record<string, unknown>> {
    const update: Record<string, unknown> = {};
    if (dto.fullName !== undefined) update.fullName = dto.fullName;
    if (dto.birthday !== undefined) update.birthday = dto.birthday ? new Date(dto.birthday) : null;

    const user = await this.users.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return this.profileFor(id);
  }

  async addMembership(userId: string, groupId: string, role: Role): Promise<void> {
    await this.users.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $pull: { memberships: { groupId: new Types.ObjectId(groupId) } },
      },
    );
    await this.users.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $push: {
          memberships: {
            groupId: new Types.ObjectId(groupId),
            role,
            joinedAt: new Date(),
          },
        },
      },
    );
  }

  async listGroupStudents(groupId: string): Promise<UserDocument[]> {
    return this.users
      .find({ 'memberships.groupId': new Types.ObjectId(groupId) })
      .sort({ fullName: 1, firstName: 1 })
      .exec();
  }

  async listGroupMembersForUi(groupId: string): Promise<
    Array<{ _id: string; fullName: string; role: Role; username?: string }>
  > {
    const members = await this.listGroupStudents(groupId);
    return members.map((u) => {
      const m = (u.memberships ?? []).find((x) => String(x.groupId) === groupId);
      const display = u.fullName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      return {
        _id: String(u._id),
        fullName: display || u.username || 'Без імені',
        username: u.username,
        role: m?.role ?? Role.Student,
      };
    });
  }
}
