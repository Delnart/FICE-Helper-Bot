import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { AcademicGroup, AcademicGroupDocument } from './group.schema';
import { User, UserDocument } from '../users/user.schema';
import { SheetsService } from '../sheets/sheets.service';
import { RequestUser } from '../../common/types/request-user';

export interface GroupSettingsView {
  _id: string;
  name: string;
  notificationsEnabled: boolean;
  birthdayAnnouncementsEnabled: boolean;
  lessonReminderMinutes: number;
  campusGroupId?: string;
  canEdit: boolean;
  iAmHead: boolean;
  headUserId: string;
  deputyUserIds: string[];
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly sheets: SheetsService,
  ) {}

  async findById(id: string): Promise<AcademicGroupDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Group not found');
    const group = await this.groups.findById(id).exec();
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  /** Mark a group active again (bot re-added to the chat). */
  async markActive(groupId: string): Promise<void> {
    await this.groups.updateOne({ _id: groupId }, { $set: { status: 'active' } }).exec();
  }

  /** Mark a group inactive (bot was kicked or chat deleted). */
  async markInactive(groupId: string): Promise<void> {
    await this.groups.updateOne({ _id: groupId }, { $set: { status: 'inactive' } }).exec();
  }

  async getSettingsForUser(user: RequestUser, groupId: string): Promise<GroupSettingsView> {
    const group = await this.findById(groupId);
    const membership = user.memberships.find((m) => m.groupId === groupId);
    const level = membership ? ROLE_LEVEL[membership.role] : 0;
    const canEdit = level >= ROLE_LEVEL[Role.DeputyHead];
    const iAmHead = String(group.headUserId) === user.userId;
    return {
      _id: String(group._id),
      name: group.academicName,
      notificationsEnabled: group.notificationsEnabled,
      birthdayAnnouncementsEnabled: group.birthdayAnnouncementsEnabled,
      lessonReminderMinutes: group.lessonReminderMinutes,
      campusGroupId: group.campusGroupId,
      canEdit,
      iAmHead,
      headUserId: String(group.headUserId),
      deputyUserIds: (group.deputyUserIds ?? []).map((d) => String(d)),
    };
  }

  async setCampusGroupId(
    user: RequestUser,
    groupId: string,
    campusGroupId: string,
  ): Promise<GroupSettingsView> {
    const membership = user.memberships.find((m) => m.groupId === groupId);
    const level = membership ? ROLE_LEVEL[membership.role] : 0;
    if (level < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException('Only head/deputy can bind campus group');
    }
    const trimmed = (campusGroupId ?? '').trim();
    if (!trimmed) throw new BadRequestException('campusGroupId is required');
    const group = await this.findById(groupId);
    group.campusGroupId = trimmed;
    await group.save();
    return this.getSettingsForUser(user, groupId);
  }

  async updateSettingsForUser(
    user: RequestUser,
    groupId: string,
    dto: { lessonReminderMinutes?: number; notificationsEnabled?: boolean; birthdayAnnouncementsEnabled?: boolean },
  ): Promise<GroupSettingsView> {
    const membership = user.memberships.find((m) => m.groupId === groupId);
    const level = membership ? ROLE_LEVEL[membership.role] : 0;
    if (level < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException('Only head/deputy can update group settings');
    }
    await this.updateReminderSettings(groupId, dto);
    return this.getSettingsForUser(user, groupId);
  }

  async findByChat(telegramChatId: number): Promise<AcademicGroupDocument | null> {
    return this.groups.findOne({ telegramChatId }).exec();
  }

  async findByHeadTelegramId(telegramId: number): Promise<AcademicGroupDocument[]> {
    const user = await this.users.findOne({ telegramId }).lean().exec();
    if (!user) return [];
    return this.groups.find({ headUserId: user._id }).exec();
  }

  async findByHeadAndAcademicName(
    telegramId: number,
    academicName: string,
  ): Promise<AcademicGroupDocument | null> {
    const user = await this.users.findOne({ telegramId }).lean().exec();
    if (!user) return null;
    return this.groups.findOne({ headUserId: user._id, academicName }).exec();
  }

  /**
   * Move a head's group binding to a new chat (or set the message thread of the
   * current chat). Used by the bot's /migrate command.
   */
  async migrateGroupChat(params: {
    headTelegramId: number;
    academicName: string;
    newTelegramChatId: number;
    messageThreadId?: number;
  }): Promise<AcademicGroupDocument> {
    const group = await this.findByHeadAndAcademicName(
      params.headTelegramId,
      params.academicName,
    );
    if (!group) {
      throw new NotFoundException('Group not found for this head');
    }
    // If the chat is changing, free the old chat-id (it stays unique).
    if (group.telegramChatId !== params.newTelegramChatId) {
      // Move the existing record to the new chatId. If another group was bound to
      // that chat (rare: same head reusing a chat) — refuse, the admin must clean up.
      const colliding = await this.groups
        .findOne({
          telegramChatId: params.newTelegramChatId,
          _id: { $ne: group._id },
        })
        .exec();
      if (colliding) {
        throw new BadRequestException(
          `Цей чат уже привʼязано до групи ${colliding.academicName}. Спочатку відвʼяжіть її.`,
        );
      }
      group.telegramChatId = params.newTelegramChatId;
    }
    if (params.messageThreadId !== undefined) {
      group.messageThreadId = params.messageThreadId;
    }
    await group.save();
    return group;
  }

  async bindTelegramChat(params: {
    telegramChatId: number;
    messageThreadId?: number;
    academicName: string;
    campusGroupId?: string;
    headTelegramId: number;
    headTelegramUsername: string;
    headFirstName: string;
    headLastName?: string;
    /** Skip the Sheets head-roster check. Used by the chat-admin override path. */
    skipAuthCheck?: boolean;
  }): Promise<AcademicGroupDocument> {
    if (!params.skipAuthCheck && this.sheets.isConfigured()) {
      const authorized = await this.sheets.findHead(params.headTelegramUsername);
      if (!authorized) {
        throw new ForbiddenException(
          'Ваш Telegram тег не знайдено серед старост у таблиці. Зверніться до адміністратора.',
        );
      }
    }

    const headUser = await this.users.findOneAndUpdate(
      { telegramId: params.headTelegramId },
      {
        $set: {
          firstName: params.headFirstName,
          lastName: params.headLastName,
          username: params.headTelegramUsername,
        },
      },
      { upsert: true, new: true },
    );

    // 1. The chat itself is already bound — same head + same group? refresh; otherwise refuse.
    const byChat = await this.groups.findOne({ telegramChatId: params.telegramChatId }).exec();
    if (byChat) {
      const sameHead = String(byChat.headUserId) === String(headUser._id);
      const sameGroup = byChat.academicName === params.academicName;
      if (sameHead && sameGroup) {
        if (params.campusGroupId) byChat.campusGroupId = params.campusGroupId;
        if (params.messageThreadId !== undefined) byChat.messageThreadId = params.messageThreadId;
        await byChat.save();
        await this.ensureMembership(
          headUser._id as Types.ObjectId,
          byChat._id as Types.ObjectId,
          Role.GroupHead,
        );
        return byChat;
      }
      throw new BadRequestException(
        `Цей чат уже привʼязано до групи ${byChat.academicName}. Спочатку відвʼяжіть її.`,
      );
    }

    // 2. The head has an existing group with this academic name — migrate to this chat,
    // but only if the group is inactive (bot was removed) or already bound to this same chat.
    // If it's active in a different chat, refuse and instruct to use /migrate explicitly.
    const byHead = await this.groups
      .findOne({ headUserId: headUser._id, academicName: params.academicName })
      .exec();
    if (byHead) {
      if (
        byHead.status === 'active' &&
        byHead.telegramChatId !== params.telegramChatId
      ) {
        throw new BadRequestException(
          `Група ${params.academicName} вже активна в іншому чаті. ` +
          `Щоб перенести її сюди — надішліть /migrate у цьому чаті.`,
        );
      }
      byHead.telegramChatId = params.telegramChatId;
      byHead.status = 'active';
      if (params.messageThreadId !== undefined) byHead.messageThreadId = params.messageThreadId;
      if (params.campusGroupId) byHead.campusGroupId = params.campusGroupId;
      await byHead.save();
      await this.ensureMembership(
        headUser._id as Types.ObjectId,
        byHead._id as Types.ObjectId,
        Role.GroupHead,
      );
      return byHead;
    }

    // 3. Fresh create.
    const created = await this.groups.create({
      academicName: params.academicName,
      telegramChatId: params.telegramChatId,
      messageThreadId: params.messageThreadId,
      campusGroupId: params.campusGroupId,
      headUserId: headUser._id,
      deputyUserIds: [],
    });
    await this.ensureMembership(headUser._id as Types.ObjectId, created._id as Types.ObjectId, Role.GroupHead);
    return created;
  }

  async assignDeputy(groupId: string, requestingUserId: string, targetUserId: string): Promise<void> {
    const group = await this.findById(groupId);
    if (String(group.headUserId) !== requestingUserId) {
      throw new ForbiddenException('Only group head can assign deputies');
    }
    if (String(group.headUserId) === targetUserId) {
      throw new BadRequestException('Head cannot be their own deputy');
    }
    await this.groups.updateOne(
      { _id: group._id },
      { $addToSet: { deputyUserIds: new Types.ObjectId(targetUserId) } },
    );
    await this.ensureMembership(
      new Types.ObjectId(targetUserId),
      group._id as Types.ObjectId,
      Role.DeputyHead,
    );
  }

  async removeDeputy(groupId: string, requestingUserId: string, targetUserId: string): Promise<void> {
    const group = await this.findById(groupId);
    if (String(group.headUserId) !== requestingUserId) {
      throw new ForbiddenException('Only group head can remove deputies');
    }
    await this.groups.updateOne(
      { _id: group._id },
      { $pull: { deputyUserIds: new Types.ObjectId(targetUserId) } },
    );
    await this.ensureMembership(
      new Types.ObjectId(targetUserId),
      group._id as Types.ObjectId,
      Role.Student,
    );
  }

  async updateReminderSettings(
    groupId: string,
    dto: { lessonReminderMinutes?: number; notificationsEnabled?: boolean; birthdayAnnouncementsEnabled?: boolean },
  ): Promise<AcademicGroupDocument> {
    const update: Record<string, unknown> = {};
    if (dto.lessonReminderMinutes !== undefined) {
      if (dto.lessonReminderMinutes < 0 || dto.lessonReminderMinutes > 60) {
        throw new BadRequestException('lessonReminderMinutes must be 0..60');
      }
      update.lessonReminderMinutes = dto.lessonReminderMinutes;
    }
    if (dto.notificationsEnabled !== undefined) update.notificationsEnabled = dto.notificationsEnabled;
    if (dto.birthdayAnnouncementsEnabled !== undefined)
      update.birthdayAnnouncementsEnabled = dto.birthdayAnnouncementsEnabled;

    const group = await this.groups.findByIdAndUpdate(groupId, { $set: update }, { new: true });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  private async ensureMembership(
    userId: Types.ObjectId,
    groupId: Types.ObjectId,
    role: Role,
  ): Promise<void> {
    await this.users.updateOne(
      { _id: userId },
      { $pull: { memberships: { groupId } } },
    );
    await this.users.updateOne(
      { _id: userId },
      {
        $push: {
          memberships: { groupId, role, joinedAt: new Date() },
        },
      },
    );
  }

  async listMyGroups(userId: string): Promise<AcademicGroupDocument[]> {
    const user = await this.users.findById(userId).lean().exec();
    if (!user) return [];
    const ids = user.memberships.map((m) => m.groupId);
    return this.groups.find({ _id: { $in: ids } }).exec();
  }

  /** Return minimal group info for the join-request picker (no sensitive fields). */
  async searchPublic(q: string): Promise<Array<{ _id: string; academicName: string }>> {
    const filter = q.trim()
      ? { academicName: { $regex: q.trim(), $options: 'i' } }
      : {};
    const results = await this.groups
      .find(filter, { academicName: 1 })
      .sort({ academicName: 1 })
      .limit(20)
      .lean()
      .exec();
    return results.map((g) => ({ _id: String(g._id), academicName: g.academicName }));
  }
}
