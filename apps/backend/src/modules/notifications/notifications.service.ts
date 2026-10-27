import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Announcement, AnnouncementDocument } from './announcement.schema';
import {
  effectivePref,
  effectivePrefs,
  NotificationPrefs,
  NotificationPrefsDocument,
  PrefKey,
} from './notification-prefs.schema';
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

const PREF_KEY: Record<DmKind, PrefKey> = {
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

  async getPrefs(userId: string, groupId?: string): Promise<Record<PrefKey, boolean>> {
    // Read-only: a missing row means the defaults, nothing to create.
    const prefs = await this.prefs.findOne({ userId: new Types.ObjectId(userId) }).lean().exec();
    return effectivePrefs(prefs, groupId);
  }

  async updatePrefs(userId: string, dto: UpdatePrefsDto): Promise<Record<PrefKey, boolean>> {
    const { groupId, ...rest } = dto;
    // ES2022 class fields leave absent keys as own `undefined` properties.
    const values = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const oid = new Types.ObjectId(userId);
    if (!groupId) {
      // Atomic single-roundtrip update: `$set` only touches the keys present in
      // `dto`. `upsert` handles first-call-ever, `setDefaultsOnInsert` writes the
      // schema defaults (opt-out flags `true`, opt-in ones `false`) on creation.
      const prefs = await this.prefs
        .findOneAndUpdate(
          { userId: oid },
          { $set: values, $setOnInsert: { userId: oid } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .lean()
        .exec();
      return effectivePrefs(prefs);
    }
    // Row, then the group's entry, then its values: each step is a single-document
    // atomic write that is a no-op when already done, so concurrent PATCHes can't
    // create a second row (unique userId) or a second entry for the same group.
    const gid = new Types.ObjectId(groupId);
    await this.prefs.updateOne({ userId: oid }, { $setOnInsert: { userId: oid } }, { upsert: true }).exec();
    await this.prefs
      .updateOne({ userId: oid, 'groups.groupId': { $ne: gid } }, { $push: { groups: { groupId: gid } } })
      .exec();
    if (Object.keys(values).length) {
      await this.prefs
        .updateOne(
          { userId: oid },
          { $set: Object.fromEntries(Object.entries(values).map(([k, v]) => [`groups.$[g].${k}`, v])) },
          { arrayFilters: [{ 'g.groupId': gid }] },
        )
        .exec();
    }
    return this.getPrefs(userId, groupId);
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

  /** `groupId`: the group the DM is about (homework, queue, …) — prefs are per group. */
  async sendDm(userId: string, groupId: string, kind: DmKind, text: string): Promise<void> {
    // Read-only lookup: a missing row / field means the default, so there's no
    // need to create a prefs document per recipient here.
    const key = PREF_KEY[kind];
    const prefs = await this.prefs
      .findOne({ userId: new Types.ObjectId(userId) }, { [key]: 1, groups: 1 })
      .lean()
      .exec();
    if (!effectivePref(prefs, groupId, key)) return;
    const user = await this.users.findById(userId, { telegramId: 1 }).lean().exec();
    if (!user) return;
    await this.bot.sendMessage(user.telegramId, text);
  }

  /** For opt-in DMs whose recipients the caller already selected by prefs; send failures are logged by BotService. */
  async sendDirect(telegramId: number, text: string): Promise<void> {
    await this.bot.sendMessage(telegramId, text);
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

export interface DigestLesson {
  /** Set only when the user is in several groups. */
  groupName?: string;
  subjectName: string;
  lessonType: LessonType;
  startTime: string;
  endTime: string;
  room?: string;
}

export interface DigestDeadline {
  groupName?: string;
  title: string;
  subjectName?: string;
  deadline: Date;
}

/** 08:00 DM: today's lessons and deadlines; null when there is nothing to say. */
export function buildMorningDigestText(
  today: Date,
  lessons: DigestLesson[],
  deadlines: DigestDeadline[],
): string | null {
  if (lessons.length === 0 && deadlines.length === 0) return null;
  const prefix = (groupName?: string) => (groupName ? `<i>${escapeHtml(groupName)}</i> · ` : '');
  const date = today.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' });

  const headers = ['📚 <b>Пари</b>', '⏳ <b>Дедлайни сьогодні</b>'];

  const lines = [`☀️ Доброго ранку! Сьогодні ${escapeHtml(date)}`];
  if (lessons.length) {
    lines.push('', headers[0]);
    for (const l of [...lessons].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      const parts = [
        `<b>${escapeHtml(l.startTime)}–${escapeHtml(l.endTime)}</b>`,
        `${prefix(l.groupName)}${escapeHtml(l.subjectName)}`,
        escapeHtml(LESSON_TYPE_LABEL[l.lessonType]),
      ];
      if (l.room?.trim()) parts.push(`📍 ${escapeHtml(l.room.trim())}`);
      lines.push(parts.join(' · '));
    }
  }
  if (deadlines.length) {
    lines.push('', headers[1]);
    for (const d of [...deadlines].sort((a, b) => a.deadline.getTime() - b.deadline.getTime())) {
      const parts = [`• ${prefix(d.groupName)}<b>${escapeHtml(d.title)}</b>`];
      if (d.subjectName) parts.push(escapeHtml(d.subjectName));
      const hh = d.deadline.getHours();
      const mm = d.deadline.getMinutes();
      // 23:59 is the "end of day" default — only a real cut-off time is worth showing.
      if (hh !== 23 || mm !== 59) parts.push(`до ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
      lines.push(parts.join(' · '));
    }
  }

  let text = lines[0];
  for (let i = 1; i < lines.length; i++) {
    if (text.length + lines[i].length + 1 > MAX_REMINDER_CHARS) {
      return `${text}\n…і ще ${lines.slice(i).filter((x) => x && !headers.includes(x)).length}`;
    }
    text += `\n${lines[i]}`;
  }
  return text;
}
