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

export interface LessonReminder {
  subjectName: string;
  lessonType: LessonType;
  teacherNames: string[];
  startTime: string;
  endTime: string;
  room?: string;
  link?: ReminderLink;
}

/** Telegram rejects messages over 4096 chars; leave room for the "…і ще N" tail. */
const MAX_REMINDER_CHARS = 3900;

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
      if (group && group.telegramChatId) {
        const opts = group.messageThreadId ? { message_thread_id: group.messageThreadId } : undefined;
        await this.bot.sendMessage(
          group.telegramChatId,
          `<b>${escapeHtml(dto.title)}</b>\n\n${escapeHtml(dto.body)}`,
          opts,
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
    // Read-only lookup: a missing row / field means the schema default (true),
    // so there's no need to create a prefs document per recipient here.
    const key = PREF_KEY[kind];
    const prefs = await this.prefs
      .findOne({ userId: new Types.ObjectId(userId) }, { [key]: 1 })
      .lean()
      .exec();
    if (prefs?.[key] === false) return;
    const user = await this.users.findById(userId, { telegramId: 1 }).lean().exec();
    if (!user) return;
    await this.bot.sendMessage(user.telegramId, text);
  }

  /**
   * One chat message for every lesson of the group that starts at the same
   * minute — subgroups and electives used to produce one message each.
   */
  async broadcastLessonReminders(groupId: string, minutesLeft: number, lessons: LessonReminder[]): Promise<void> {
    if (lessons.length === 0) return;
    const group = await this.groups.findById(groupId).exec();
    if (!group || !group.notificationsEnabled || !group.telegramChatId) return;

    const opts = group.messageThreadId ? { message_thread_id: group.messageThreadId } : undefined;
    await this.bot.sendMessage(group.telegramChatId, buildLessonRemindersText(minutesLeft, lessons), opts);
  }

  async broadcastQueueOpen(params: { groupId: string; subjectName: string; queueTitle: string }): Promise<void> {
    const group = await this.groups.findById(params.groupId).exec();
    if (!group || !group.notificationsEnabled || !group.telegramChatId) return;
    const opts = group.messageThreadId ? { message_thread_id: group.messageThreadId } : undefined;
    await this.bot.sendMessage(
      group.telegramChatId,
      `<b>За 5 хв відкриється черга:</b> ${escapeHtml(params.queueTitle)} (${escapeHtml(params.subjectName)})`,
      opts,
    );
  }

  async announceBirthday(groupId: string, fullName: string): Promise<void> {
    const group = await this.groups.findById(groupId).exec();
    if (!group || !group.birthdayAnnouncementsEnabled || !group.telegramChatId) return;
    const opts = group.messageThreadId ? { message_thread_id: group.messageThreadId } : undefined;
    await this.bot.sendMessage(
      group.telegramChatId,
      `Сьогодні день народження у <b>${escapeHtml(fullName)}</b>. Вітаємо!`,
      opts,
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

/** Reminder text for one or several lessons starting at the same minute. */
export function buildLessonRemindersText(minutesLeft: number, lessons: LessonReminder[]): string {
  const teachers = (l: LessonReminder) => (l.teacherNames.length ? escapeHtml(l.teacherNames.join(', ')) : '—');
  const room = (l: LessonReminder) => escapeHtml((l.room ?? '').trim() || '—');
  const time = (l: LessonReminder) => `<b>${escapeHtml(l.startTime)}</b> — <b>${escapeHtml(l.endTime)}</b>`;

  if (lessons.length === 1) {
    const [l] = lessons;
    const lines = [
      `🔔 Нагадування про пару через ${minutesLeft} хвилин!`,
      '',
      `📚 Дисципліна: <b>${escapeHtml(l.subjectName)}</b>`,
      `📝 Тип: <b>${escapeHtml(LESSON_TYPE_LABEL[l.lessonType])}</b>`,
      `👨‍🏫 Викладач: ${teachers(l)}`,
      `⏰ Час: ${time(l)}`,
      `📍 Місце: <b>${room(l)}</b>`,
    ];
    if (l.link) lines.push(`🔗 Приєднатися до зустрічі: ${formatReminderLink(l.link)}`);
    return lines.join('\n');
  }

  const sorted = [...lessons].sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'uk'));
  const sameTime = sorted.every((l) => l.startTime === sorted[0].startTime && l.endTime === sorted[0].endTime);
  const header = [`🔔 Через ${minutesLeft} хвилин пари (${sorted.length}):`];
  if (sameTime) header.push(`⏰ ${time(sorted[0])}`);

  const blocks = sorted.map((l, i) => {
    const lines = [
      `<b>${i + 1}. ${escapeHtml(l.subjectName)}</b> · ${escapeHtml(LESSON_TYPE_LABEL[l.lessonType])}`,
      `👨‍🏫 ${teachers(l)} · 📍 ${room(l)}`,
    ];
    if (!sameTime) lines.push(`⏰ ${time(l)}`);
    if (l.link) lines.push(`🔗 ${formatReminderLink(l.link)}`);
    return lines.join('\n');
  });

  let text = header.join('\n');
  for (let i = 0; i < blocks.length; i++) {
    if (text.length + blocks[i].length + 2 > MAX_REMINDER_CHARS) return `${text}\n\n…і ще ${blocks.length - i}`;
    text += `\n\n${blocks[i]}`;
  }
  return text;
}

function formatReminderLink(link: ReminderLink): string {
  const label = link.label.trim() || link.url;
  return `<a href="${escapeHtmlAttr(link.url)}">${escapeHtml(label)}</a>`;
}
