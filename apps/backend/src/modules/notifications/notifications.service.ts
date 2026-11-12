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
import { announcementCard, birthdayCard, Card, lessonReminderCard, pairs, queueSoonCard, span } from '../bot/cards/templates';
import { quote } from '../../common/telegram-html';
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
  /** 1..8, for «2-га пара» on the card. */
  lessonNumber?: number;
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
        const author = await this.users.findById(userId, { fullName: 1, firstName: 1, lastName: 1 }).lean().exec();
        const name = author?.fullName?.trim() || [author?.firstName, author?.lastName].filter(Boolean).join(' ');
        const role =
          String(group.headUserId) === userId
            ? 'староста'
            : group.deputyUserIds.some((id) => String(id) === userId)
              ? 'заступник'
              : undefined;
        const text =
          `📣 <b>${escapeHtml(dto.title)}</b>\n\n${escapeHtml(dto.body)}` +
          (name ? `\n\n<i>${escapeHtml([name, role].filter(Boolean).join(', '))}</i>` : '');
        const card = announcementCard(group.academicName, dto.title, dto.body, new Date(), name ? { name, role } : undefined);
        // No card for a long announcement or one with links (see announcementCard): that one goes out as this text.
        await this.bot.sendCard(group.telegramChatId, card, text, opts);
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

  /** `groupId`: the group the DM is about (homework, queue, …) — prefs are per group. `card` goes out above the text, as its link preview. */
  async sendDm(userId: string, groupId: string, kind: DmKind, text: string, card?: Card): Promise<void> {
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
    await this.sendDirect(user.telegramId, text, card);
  }

  /** For opt-in DMs whose recipients the caller already selected by prefs; send failures are logged by BotService. */
  async sendDirect(telegramId: number, text: string, card?: Card): Promise<void> {
    if (card) await this.bot.sendCard(telegramId, card, text);
    else await this.bot.sendMessage(telegramId, text);
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
    await this.bot.sendCard(
      group.telegramChatId,
      lessonReminderCard(group.academicName, minutesLeft, lessons),
      buildLessonRemindersText(minutesLeft, lessons),
      opts,
    );
  }

  async broadcastQueueOpen(params: { groupId: string; subjectName: string; queueTitle: string; opensAt: Date }): Promise<void> {
    const group = await this.groups.findById(params.groupId).exec();
    if (!group || !group.notificationsEnabled || !group.telegramChatId) return;
    const opts = group.messageThreadId ? { message_thread_id: group.messageThreadId } : undefined;
    await this.bot.sendCard(
      group.telegramChatId,
      queueSoonCard(group.academicName, params.queueTitle, params.opensAt, new Date()),
      `⏱️ <b>Черга відкриється за 5 хв</b>\n\n${quote(`<b>${escapeHtml(params.queueTitle)}</b>`, escapeHtml(params.subjectName))}`,
      opts,
    );
  }

  async announceBirthday(groupId: string, fullName: string, telegramId: number): Promise<void> {
    const group = await this.groups.findById(groupId).exec();
    if (!group || !group.birthdayAnnouncementsEnabled || !group.telegramChatId) return;
    const opts = group.messageThreadId ? { message_thread_id: group.messageThreadId } : undefined;
    await this.bot.sendCard(
      group.telegramChatId,
      birthdayCard(group.academicName, fullName, await this.bot.avatar(telegramId)),
      `🎂 <b>${escapeHtml(fullName)}</b> святкує день народження!\nВітаємо 🎉`,
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

/**
 * Reminder text for one or several lessons starting at the same minute: a headline, then a quote block
 * for each lesson with a line for what it has.
 */
export function buildLessonRemindersText(minutesLeft: number, lessons: LessonReminder[]): string {
  const sorted = [...lessons].sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'uk'));
  const soon = `через ${span(minutesLeft)}`;
  let text = `🔔 <b>${sorted.length === 1 ? `Пара ${soon}` : `${pairs(sorted.length)} ${soon}`}</b>\n`;
  for (const [i, l] of sorted.entries()) {
    const block = quote(
      `<b>${escapeHtml(l.subjectName)}</b>`,
      `🕒 ${escapeHtml(l.startTime)} – ${escapeHtml(l.endTime)} · ${escapeHtml(LESSON_TYPE_LABEL[l.lessonType])}`,
      l.room?.trim() && `📍 ${escapeHtml(l.room.trim())}`,
      l.teacherNames.length > 0 && `👤 ${escapeHtml(l.teacherNames.join(', '))}`,
      l.link && `🔗 ${formatReminderLink(l.link)}`,
    );
    if (text.length + block.length + 1 > MAX_REMINDER_CHARS) return `${text}\n…і ще ${sorted.length - i}`;
    text += `\n${block}`;
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
  const dots = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' · ');
  const group = (name?: string) => name && `<i>${escapeHtml(name)}</i>`;
  const date = today.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });

  // A section is a quote block; an item in it takes two lines, what matters first.
  const sections: Array<[title: string, items: string[]]> = [];
  if (lessons.length) {
    const items = [...lessons]
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(
        (l) =>
          `${dots(`<b>${escapeHtml(l.startTime)} – ${escapeHtml(l.endTime)}</b>`, escapeHtml(LESSON_TYPE_LABEL[l.lessonType]), l.room?.trim() && escapeHtml(l.room.trim()))}\n` +
          dots(group(l.groupName), escapeHtml(l.subjectName)),
      );
    sections.push(['📚 <b>Пари</b>', items]);
  }
  if (deadlines.length) {
    const items = [...deadlines]
      .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
      .map((d) => {
        const hh = d.deadline.getHours();
        const mm = d.deadline.getMinutes();
        // 23:59 is the "end of day" default — only a real cut-off time is worth showing.
        const until = (hh !== 23 || mm !== 59) && `до ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        const about = dots(group(d.groupName), d.subjectName && escapeHtml(d.subjectName));
        return dots(`<b>${escapeHtml(d.title)}</b>`, until) + (about && `\n${about}`);
      });
    sections.push(['⏳ <b>Дедлайни сьогодні</b>', items]);
  }

  let text = `☀️ <b>Доброго ранку!</b> Сьогодні ${escapeHtml(date)}`;
  let cut = 0;
  for (const [title, items] of sections) {
    // Whole items only, so that a block always closes; once one does not fit, the rest are counted.
    let body = '';
    for (const item of items) {
      if (cut || text.length + title.length + body.length + item.length + 40 > MAX_REMINDER_CHARS) cut++;
      else body += (body && '\n\n') + item;
    }
    if (body) text += `\n\n${title}\n<blockquote>${body}</blockquote>`;
  }
  return cut ? `${text}\n…і ще ${cut}` : text;
}
