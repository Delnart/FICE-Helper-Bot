import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Announcement, AnnouncementDocument } from './announcement.schema';
import { NotificationPrefs, NotificationPrefsDocument } from './notification-prefs.schema';
import { User, UserDocument } from '../users/user.schema';
import { BotService } from '../bot/bot.service';
import { CreateAnnouncementDto, UpdatePrefsDto } from './dto/announcement.dto';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';

export type DmKind = 'queueOpen' | 'nextInQueue' | 'deadlineTomorrow' | 'swapRequest';

type LessonType = 'lecture' | 'practice' | 'lab' | 'seminar' | 'other';

interface ReminderLink {
  label: string;
  url: string;
}

const PREF_KEY: Record<DmKind, keyof NotificationPrefs> = {
  queueOpen: 'dmQueueOpen',
  nextInQueue: 'dmNextInQueue',
  deadlineTomorrow: 'dmDeadlineTomorrow',
  swapRequest: 'dmSwapRequests',
};

const LESSON_TYPE_LABEL: Record<LessonType, string> = {
  lecture: 'Лекція',
  practice: 'Практика',
  lab: 'Лабораторна',
  seminar: 'Семінар',
  other: 'Інше',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Announcement.name) private readonly announcements: Model<AnnouncementDocument>,
    @InjectModel(NotificationPrefs.name) private readonly prefs: Model<NotificationPrefsDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    private readonly bot: BotService,
  ) {}

  async getOrCreatePrefs(userId: string): Promise<NotificationPrefsDocument> {
    const oid = new Types.ObjectId(userId);
    let prefs = await this.prefs.findOne({ userId: oid }).exec();
    if (!prefs) prefs = await this.prefs.create({ userId: oid });
    return prefs;
  }

  async updatePrefs(userId: string, dto: UpdatePrefsDto): Promise<NotificationPrefsDocument> {
    // Atomic single-roundtrip update: `$set` only touches the keys present in
    // `dto`, leaves all other booleans untouched. Earlier `Object.assign + save`
    // approach could (rarely) lose recent writes if two PATCH requests landed
    // on overlapping document instances — that's now impossible.
    // `upsert: true` handles first-call-ever, `setDefaultsOnInsert` writes the
    // schema defaults (`true` for every flag) on initial creation.
    const oid = new Types.ObjectId(userId);
    const prefs = await this.prefs
      .findOneAndUpdate(
        { userId: oid },
        { $set: dto, $setOnInsert: { userId: oid } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!prefs) {
      // Theoretically unreachable because of `upsert: true`, but TypeScript
      // narrows the return to `NotificationPrefsDocument | null`.
      throw new Error('Failed to upsert notification prefs');
    }
    return prefs;
  }

  async createAnnouncement(userId: string, dto: CreateAnnouncementDto): Promise<AnnouncementDocument> {
    const ann = await this.announcements.create({
      groupId: new Types.ObjectId(dto.groupId),
      title: dto.title,
      body: dto.body,
      createdBy: new Types.ObjectId(userId),
      broadcastedToChat: false,
    });

    if (dto.broadcastToChat) {
      const group = await this.groups.findById(dto.groupId).exec();
      if (group) {
        await this.bot.sendMessage(
          group.telegramChatId,
          `<b>${escapeHtml(dto.title)}</b>\n\n${escapeHtml(dto.body)}`,
        );
        ann.broadcastedToChat = true;
        await ann.save();
      }
    }
    return ann;
  }

  async listAnnouncements(groupId: string): Promise<AnnouncementDocument[]> {
    return this.announcements
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async sendDm(userId: string, kind: DmKind, text: string): Promise<void> {
    const prefs = await this.getOrCreatePrefs(userId);
    if (!prefs[PREF_KEY[kind]]) return;
    const user = await this.users.findById(userId).lean().exec();
    if (!user) return;
    await this.bot.sendMessage(user.telegramId, text);
  }

  async broadcastLessonReminder(params: {
    groupId: string;
    subjectName: string;
    lessonType: LessonType;
    teacherNames: string[];
    startTime: string;
    endTime: string;
    room?: string;
    link?: ReminderLink;
    minutesLeft: number;
  }): Promise<void> {
    const group = await this.groups.findById(params.groupId).exec();
    if (!group || !group.notificationsEnabled) return;

    await this.bot.sendMessage(group.telegramChatId, this.buildLessonReminderText(params));
  }

  private buildLessonReminderText(params: {
    subjectName: string;
    lessonType: LessonType;
    teacherNames: string[];
    startTime: string;
    endTime: string;
    room?: string;
    link?: ReminderLink;
    minutesLeft: number;
  }): string {
    const lines = [
      `🔔 Нагадування про пару через ${params.minutesLeft} хвилин!`,
      '',
      `📚 Предмет: <b>${escapeHtml(params.subjectName)}</b>`,
      `📝 Тип: <b>${escapeHtml(LESSON_TYPE_LABEL[params.lessonType])}</b>`,
      `👨‍🏫 Викладач: ${params.teacherNames.length ? escapeHtml(params.teacherNames.join(', ')) : '—'}`,
      `⏰ Час: <b>${escapeHtml(params.startTime)}</b> — <b>${escapeHtml(params.endTime)}</b>`,
      `📍 Місце: <b>${escapeHtml((params.room ?? '').trim() || '—')}</b>`,
    ];
    if (params.link) lines.push(`🔗 Приєднатися до зустрічі: ${formatReminderLink(params.link)}`);
    return lines.join('\n');
  }

  async broadcastQueueOpen(params: { groupId: string; subjectName: string; queueTitle: string }): Promise<void> {
    const group = await this.groups.findById(params.groupId).exec();
    if (!group || !group.notificationsEnabled) return;
    await this.bot.sendMessage(
      group.telegramChatId,
      `<b>За 5 хв відкриється черга:</b> ${escapeHtml(params.queueTitle)} (${escapeHtml(params.subjectName)})`,
    );
  }

  async announceBirthday(groupId: string, fullName: string): Promise<void> {
    const group = await this.groups.findById(groupId).exec();
    if (!group || !group.birthdayAnnouncementsEnabled) return;
    await this.bot.sendMessage(
      group.telegramChatId,
      `Сьогодні день народження у <b>${escapeHtml(fullName)}</b>. Вітаємо!`,
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReminderLink(link: ReminderLink): string {
  const label = link.label.trim() || link.url;
  return `<a href="${escapeHtmlAttr(link.url)}">${escapeHtml(label)}</a>`;
}
