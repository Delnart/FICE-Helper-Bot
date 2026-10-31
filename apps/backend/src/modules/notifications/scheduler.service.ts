import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '@fice/shared';
import {
  buildLessonRemindersText,
  buildMorningDigestText,
  LessonReminder,
  NotificationsService,
} from './notifications.service';
import { localDateKey, runsOn, ScheduleLesson, ScheduleLessonDocument } from '../schedule/schedule.schema';
import { Queue, QueueDocument } from '../queues/queue.schema';
import { Homework, HomeworkDocument } from '../homework/homework.schema';
import { HomeworkCompletion, HomeworkCompletionDocument } from '../homework/homework-completion.schema';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { User, UserDocument } from '../users/user.schema';
import { CampusService } from '../campus/campus.service';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { LessonReminderMark, LessonReminderMarkDocument } from './lesson-reminder-mark.schema';
import {
  effectivePref,
  NotificationPrefs,
  NotificationPrefsDocument,
  optedInSomewhere,
  PrefKey,
} from './notification-prefs.schema';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  /** Queue-open broadcast key -> when it was sent (pruned every tick). */
  private readonly sentMarks = new Map<string, number>();
  private lessonTickRunning = false;
  private digestRunning = false;

  constructor(
    private readonly notifications: NotificationsService,
    @InjectModel(ScheduleLesson.name) private readonly lessons: Model<ScheduleLessonDocument>,
    @InjectModel(Queue.name) private readonly queues: Model<QueueDocument>,
    @InjectModel(Homework.name) private readonly homework: Model<HomeworkDocument>,
    @InjectModel(HomeworkCompletion.name) private readonly completions: Model<HomeworkCompletionDocument>,
    @InjectModel(AcademicGroup.name) private readonly groups: Model<AcademicGroupDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @InjectModel(LessonReminderMark.name)
    private readonly reminderMarks: Model<LessonReminderMarkDocument>,
    private readonly campus: CampusService,
    @InjectModel(NotificationPrefs.name) private readonly prefs: Model<NotificationPrefsDocument>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tickLessonReminders(): Promise<void> {
    // A slow tick (many groups × Telegram sends) must not stack up with the next one.
    if (this.lessonTickRunning) return;
    this.lessonTickRunning = true;
    try {
      const now = new Date();
      const day = ((now.getDay() + 6) % 7) + 1;
      const week = await this.campus.refreshWeekParity();
      const groups = await this.groups
        // Inactive = bot was removed from the chat; sends there only fail.
        .find({ status: { $ne: 'inactive' } }, { notificationsEnabled: 1, lessonReminderMinutes: 1 })
        .lean()
        .exec();
      if (groups.length === 0) return;
      const minutesByGroup = new Map(groups.map((g) => [String(g._id), g.lessonReminderMinutes]));
      // The chat switch only gates the chat message; personal DMs are each user's own opt-in.
      const chatGroups = new Set(groups.filter((g) => g.notificationsEnabled === true).map((g) => String(g._id)));

      // One lean query for every group's lessons today, instead of two full
      // queries (lessons + subjects) per group every minute.
      const lessons = await this.lessons
        .find({ groupId: { $in: groups.map((g) => g._id) }, dayOfWeek: day, weekType: { $in: [0, week] } })
        .lean()
        .exec();
      const today = localDateKey(now);
      const due = lessons.filter((l) => {
        if (!runsOn(l, today)) return false;
        const lead = minutesByGroup.get(String(l.groupId)) ?? 0;
        const target = new Date(now.getTime() + lead * 60_000);
        const [h, m] = l.startTime.split(':').map(Number);
        return h * 60 + m === target.getHours() * 60 + target.getMinutes();
      });
      if (due.length === 0) return;

      // Dedupe as strings (ObjectIds compare by reference), query as ObjectIds.
      const toIds = (ls: typeof due) =>
        [...new Set(ls.map((l) => String(l.groupId)))].map((id) => new Types.ObjectId(id));
      const dmRecipients = await this.lessonDmRecipients(toIds(due));
      // Nobody to tell → don't claim, so a group with chat off and no opted-in members costs nothing.
      const wanted = due.filter((l) => chatGroups.has(String(l.groupId)) || dmRecipients.has(String(l.groupId)));
      if (wanted.length === 0) return;
      const dueGroupIds = toIds(wanted);
      const subjects = await this.subjects
        .find(
          { groupId: { $in: dueGroupIds } },
          { groupId: 1, name: 1, shortName: 1, links: 1 },
        )
        .lean()
        .exec();
      // One chat message per group, however many lessons (subgroups,
      // electives) start at that minute. Claims stay per lesson, so a lesson
      // is never announced twice even if two ticks overlap.
      const byGroup = new Map<string, Array<{ lesson: (typeof due)[number]; reminder: LessonReminder }>>();
      const lookups = new Map<string, ReturnType<SchedulerService['buildSubjectLookup']>>();
      for (const l of wanted) {
        const groupId = String(l.groupId);
        const claimed = await this.claimLessonReminder(groupId, String(l._id), today);
        if (!claimed) continue;

        let lookup = lookups.get(groupId);
        if (!lookup) {
          lookup = this.buildSubjectLookup(subjects.filter((s) => String(s.groupId) === groupId));
          lookups.set(groupId, lookup);
        }
        const subject = l.subjectId
          ? lookup.byId.get(String(l.subjectId))
          : lookup.byName.get(normalizeName(l.subjectName));
        byGroup.set(groupId, [
          ...(byGroup.get(groupId) ?? []),
          {
            lesson: l,
            reminder: {
              subjectName: l.subjectName,
              lessonType: l.type,
              teacherNames: l.teacherNames,
              startTime: l.startTime,
              endTime: l.endTime,
              room: l.room,
              link: this.pickReminderLink(subject, l),
            },
          },
        ]);
      }
      // Every chat first: personal DMs must not delay the group reminders that existed before them.
      for (const [groupId, list] of byGroup) {
        if (chatGroups.has(groupId)) {
          await this.notifications.broadcastLessonReminders(
            groupId,
            minutesByGroup.get(groupId) ?? 0,
            list.map((x) => x.reminder),
          );
        }
      }
      // ponytail: DMs are sent serially inside the tick; if a peak minute ever takes >60s the guard
      // skips the next tick — move DMs to a background send chain then.
      for (const [groupId, list] of byGroup) {
        const minutes = minutesByGroup.get(groupId) ?? 0;
        for (const u of dmRecipients.get(groupId) ?? []) {
          const mine = list.filter((x) => attendsLesson(x.lesson, u.id)).map((x) => x.reminder);
          if (mine.length) await this.safeDm(u.telegramId, buildLessonRemindersText(minutes, mine));
        }
      }
    } catch (err) {
      this.logger.error(`tickLessonReminders: ${(err as Error).message}`);
    } finally {
      this.lessonTickRunning = false;
    }
  }

  @Cron('0 0 8 * * *')
  async tickMorningDigest(): Promise<void> {
    if (this.digestRunning) return;
    this.digestRunning = true;
    try {
      const now = new Date();
      const prefs = await this.optedIn('dmMorningDigest');
      if (prefs.size === 0) return;
      const rows = await this.users
        // Banned users can't open settings to switch it off.
        .find(
          { _id: { $in: [...prefs.keys()].map((id) => new Types.ObjectId(id)) }, isBanned: { $ne: true } },
          { telegramId: 1, memberships: 1 },
        )
        .lean()
        .exec();
      // Only the groups where the digest is on: on in G1 and off in G2 → G1's day only.
      const users = rows
        .map((u) => ({
          id: String(u._id),
          telegramId: u.telegramId,
          groupIds: studentGroupIds(u).filter((g) => effectivePref(prefs.get(String(u._id)), g, 'dmMorningDigest')),
        }))
        .filter((u) => u.groupIds.length > 0);
      if (users.length === 0) return;
      const groupIds = [...new Set(users.flatMap((u) => u.groupIds))].map((id) => new Types.ObjectId(id));

      const day = ((now.getDay() + 6) % 7) + 1;
      const today = localDateKey(now);
      const week = await this.campus.refreshWeekParity();
      // Rest of the local (Kyiv, TZ is set in production) day: a cut-off that already passed this morning is no news.
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const [groups, lessons, homework] = await Promise.all([
        this.groups.find({ _id: { $in: groupIds } }, { academicName: 1 }).lean().exec(),
        this.lessons
          .find(
            { groupId: { $in: groupIds }, dayOfWeek: day, weekType: { $in: [0, week] } },
            {
              groupId: 1,
              subjectName: 1,
              type: 1,
              startTime: 1,
              endTime: 1,
              room: 1,
              dates: 1,
              isElective: 1,
              electiveStudentIds: 1,
            },
          )
          .lean()
          .exec(),
        this.homework
          .find(
            { groupId: { $in: groupIds }, deadline: { $gte: now, $lt: dayEnd }, teamSize: { $ne: 0 } },
            { groupId: 1, subjectId: 1, title: 1, deadline: 1 },
          )
          .lean()
          .exec(),
      ]);
      const [subjects, done] = await Promise.all([
        this.subjects.find({ _id: { $in: homework.map((h) => h.subjectId) } }, { name: 1 }).lean().exec(),
        this.completions
          .find(
            {
              homeworkId: { $in: homework.map((h) => h._id) },
              userId: { $in: users.map((u) => new Types.ObjectId(u.id)) },
              done: true,
            },
            { homeworkId: 1, userId: 1 },
          )
          .lean()
          .exec(),
      ]);

      const groupName = new Map(groups.map((g) => [String(g._id), g.academicName]));
      const subjectName = new Map(subjects.map((s) => [String(s._id), s.name]));
      const doneKeys = new Set(done.map((c) => `${c.homeworkId}:${c.userId}`));
      for (const u of users) {
        const mine = new Set(u.groupIds);
        const label = (groupId: unknown) => (u.groupIds.length > 1 ? groupName.get(String(groupId)) : undefined);
        const text = buildMorningDigestText(
          now,
          lessons
            .filter((l) => mine.has(String(l.groupId)) && runsOn(l, today) && attendsLesson(l, u.id))
            .map((l) => ({
              groupName: label(l.groupId),
              subjectName: l.subjectName,
              lessonType: l.type,
              startTime: l.startTime,
              endTime: l.endTime,
              room: l.room,
            })),
          homework
            .filter((h) => mine.has(String(h.groupId)) && !doneKeys.has(`${h._id}:${u.id}`))
            .map((h) => ({
              groupName: label(h.groupId),
              title: h.title,
              subjectName: subjectName.get(String(h.subjectId)),
              deadline: h.deadline!,
            })),
        );
        if (text) await this.safeDm(u.telegramId, text);
      }
    } catch (err) {
      this.logger.error(`tickMorningDigest: ${(err as Error).message}`);
    } finally {
      this.digestRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tickQueueOpens(): Promise<void> {
    const now = new Date();
    const inFive = new Date(now.getTime() + 5 * 60_000);
    // Marks only matter inside the 5-minute look-ahead window; drop old ones
    // so the map doesn't grow for the lifetime of the process.
    for (const [key, at] of this.sentMarks) if (now.getTime() - at > 15 * 60_000) this.sentMarks.delete(key);
    const queues = await this.queues
      .find({ 'rules.autoOpenAt': { $gte: now, $lte: inFive } }, { groupId: 1, title: 1 })
      .lean()
      .exec();
    for (const q of queues) {
      const key = `q-open:${q._id}`;
      if (this.sentMarks.has(key)) continue;
      this.sentMarks.set(key, now.getTime());
      await this.notifications.broadcastQueueOpen({
        groupId: String(q.groupId),
        subjectName: q.title,
        queueTitle: q.title,
      });
    }
  }

  @Cron('0 9 * * *')
  async tickDeadlineReminders(): Promise<void> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
    const hw = await this.homework
      .find({ deadline: { $gte: now, $lte: tomorrow }, teamSize: { $ne: 0 } })
      .exec();
    for (const h of hw) {
      const members = await this.users
        .find({ 'memberships.groupId': new Types.ObjectId(String(h.groupId)) })
        .lean()
        .exec();
      const doneRows = await this.completions
        .find({ homeworkId: h._id, done: true })
        .lean()
        .exec();
      const doneIds = new Set(doneRows.map((r) => String(r.userId)));
      for (const u of members) {
        if (doneIds.has(String(u._id))) continue;
        await this.notifications.sendDm(
          String(u._id),
          String(h.groupId),
          'deadlineTomorrow',
          `⏳ Завтра дедлайн: <b>${escapeHtml(h.title)}</b>`,
        );
      }
    }
  }

  @Cron('0 9 * * *')
  async tickBirthdays(): Promise<void> {
    const today = new Date();
    const users = await this.users
      .find({
        birthday: { $exists: true },
        $expr: {
          $and: [
            { $eq: [{ $dayOfMonth: '$birthday' }, today.getDate()] },
            { $eq: [{ $month: '$birthday' }, today.getMonth() + 1] },
          ],
        },
      })
      .exec();
    for (const u of users) {
      for (const m of u.memberships) {
        await this.notifications.announceBirthday(String(m.groupId), u.fullName ?? u.firstName);
      }
    }
  }

  /** Opted-in (dmLessonReminder, per group) members of the given groups, keyed by group id. */
  private async lessonDmRecipients(
    groupIds: Types.ObjectId[],
  ): Promise<Map<string, Array<{ id: string; telegramId: number }>>> {
    const byGroup = new Map<string, Array<{ id: string; telegramId: number }>>();
    const prefs = await this.optedIn('dmLessonReminder');
    if (prefs.size === 0) return byGroup;
    const users = await this.users
      .find(
        {
          _id: { $in: [...prefs.keys()].map((id) => new Types.ObjectId(id)) },
          'memberships.groupId': { $in: groupIds },
          isBanned: { $ne: true },
        },
        { telegramId: 1, memberships: 1 },
      )
      .lean()
      .exec();
    for (const u of users) {
      for (const groupId of studentGroupIds(u)) {
        if (!effectivePref(prefs.get(String(u._id)), groupId, 'dmLessonReminder')) continue;
        byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), { id: String(u._id), telegramId: u.telegramId }]);
      }
    }
    return byGroup;
  }

  /**
   * Prefs rows (by user id) that switched an opt-in DM on user-wide or in some
   * group; whether it's on for a given group is effectivePref's call.
   * Strictly opt-in: a row without the field anywhere never matches `true`.
   */
  private async optedIn(key: PrefKey) {
    const rows = await this.prefs.find(optedInSomewhere(key), { userId: 1, [key]: 1, groups: 1 }).lean().exec();
    return new Map(rows.map((p) => [String(p.userId), p]));
  }

  /** One failed DM (user blocked the bot, …) must not stop the rest of the batch. */
  private async safeDm(telegramId: number, text: string): Promise<void> {
    try {
      await this.notifications.sendDirect(telegramId, text);
    } catch (err) {
      this.logger.warn(`DM to ${telegramId} failed: ${(err as Error).message}`);
    }
  }

  private buildSubjectLookup(subjects: ReminderSubject[]): {
    byId: Map<string, ReminderSubject>;
    byName: Map<string, ReminderSubject>;
  } {
    const byId = new Map<string, ReminderSubject>();
    const byName = new Map<string, ReminderSubject>();
    for (const subject of subjects) {
      byId.set(String(subject._id), subject);
      byName.set(normalizeName(subject.name), subject);
      if (subject.shortName) byName.set(normalizeName(subject.shortName), subject);
    }
    return { byId, byName };
  }

  private async claimLessonReminder(groupId: string, lessonId: string, reminderDate: string): Promise<boolean> {
    try {
      const result = await this.reminderMarks
        .updateOne(
          {
            groupId: new Types.ObjectId(groupId),
            lessonId: new Types.ObjectId(lessonId),
            reminderDate,
          },
          {
            $setOnInsert: {
              groupId: new Types.ObjectId(groupId),
              lessonId: new Types.ObjectId(lessonId),
              reminderDate,
              sentAt: new Date(),
            },
          },
          { upsert: true },
        )
        .exec();
      return result.upsertedCount === 1 || result.upsertedId != null;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  private pickReminderLink(
    subject: ReminderSubject | undefined,
    lesson: Pick<ScheduleLesson, 'type' | 'meetingUrl'>,
  ): { label: string; url: string } | undefined {
    const reminderLink = subject?.links.find(
      (link) => link.showInLessonReminder && link.lessonReminderType === lesson.type,
    );
    const preferredUrl = reminderLink ? normalizeHttpUrl(reminderLink.url) : undefined;
    if (preferredUrl) {
      return {
        label: reminderLink?.label?.trim() || 'Посилання',
        url: preferredUrl,
      };
    }

    const fallbackUrl = normalizeHttpUrl(lesson.meetingUrl ?? '');
    if (!fallbackUrl) return undefined;
    return { label: 'Зустріч', url: fallbackUrl };
  }
}

type ReminderSubject = Pick<Subject, 'name' | 'shortName' | 'links'> & { _id: unknown };

/** Groups whose lessons are the user's own — a teacher membership isn't their timetable. */
function studentGroupIds(u: Pick<User, 'memberships'>): string[] {
  return [...new Set((u.memberships ?? []).filter((m) => m.role !== Role.Teacher).map((m) => String(m.groupId)))];
}

/** Same rule as the personal schedule: electives only for the students who picked them. */
function attendsLesson(l: Pick<ScheduleLesson, 'isElective' | 'electiveStudentIds'>, userId: string): boolean {
  return !l.isElective || (l.electiveStudentIds ?? []).some((id) => String(id) === userId);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'«»()\[\].,!?:;]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHttpUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000;
}
