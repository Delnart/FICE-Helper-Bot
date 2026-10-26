import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LessonReminder, NotificationsService } from './notifications.service';
import { ScheduleLesson, ScheduleLessonDocument } from '../schedule/schedule.schema';
import { Queue, QueueDocument } from '../queues/queue.schema';
import { Homework, HomeworkDocument } from '../homework/homework.schema';
import { HomeworkCompletion, HomeworkCompletionDocument } from '../homework/homework-completion.schema';
import { AcademicGroup, AcademicGroupDocument } from '../groups/group.schema';
import { User, UserDocument } from '../users/user.schema';
import { CampusService } from '../campus/campus.service';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { LessonReminderMark, LessonReminderMarkDocument } from './lesson-reminder-mark.schema';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  /** Queue-open broadcast key -> when it was sent (pruned every tick). */
  private readonly sentMarks = new Map<string, number>();
  private lessonTickRunning = false;

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
        .find({ notificationsEnabled: true, status: { $ne: 'inactive' } }, { lessonReminderMinutes: 1 })
        .lean()
        .exec();
      if (groups.length === 0) return;
      const minutesByGroup = new Map(groups.map((g) => [String(g._id), g.lessonReminderMinutes]));

      // One lean query for every group's lessons today, instead of two full
      // queries (lessons + subjects) per group every minute.
      const lessons = await this.lessons
        .find({ groupId: { $in: groups.map((g) => g._id) }, dayOfWeek: day, weekType: { $in: [0, week] } })
        .lean()
        .exec();
      const due = lessons.filter((l) => {
        const lead = minutesByGroup.get(String(l.groupId)) ?? 0;
        const target = new Date(now.getTime() + lead * 60_000);
        const [h, m] = l.startTime.split(':').map(Number);
        return h * 60 + m === target.getHours() * 60 + target.getMinutes();
      });
      if (due.length === 0) return;

      // Dedupe as strings (ObjectIds compare by reference), query as ObjectIds.
      const dueGroupIds = [...new Set(due.map((l) => String(l.groupId)))].map((id) => new Types.ObjectId(id));
      const subjects = await this.subjects
        .find(
          { groupId: { $in: dueGroupIds } },
          { groupId: 1, name: 1, shortName: 1, links: 1 },
        )
        .lean()
        .exec();
      const reminderDate = formatLocalDateKey(now);
      // One chat message per group, however many lessons (subgroups,
      // electives) start at that minute. Claims stay per lesson, so a lesson
      // is never announced twice even if two ticks overlap.
      const byGroup = new Map<string, LessonReminder[]>();
      const lookups = new Map<string, ReturnType<SchedulerService['buildSubjectLookup']>>();
      for (const l of due) {
        const groupId = String(l.groupId);
        const claimed = await this.claimLessonReminder(groupId, String(l._id), reminderDate);
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
            subjectName: l.subjectName,
            lessonType: l.type,
            teacherNames: l.teacherNames,
            startTime: l.startTime,
            endTime: l.endTime,
            room: l.room,
            link: this.pickReminderLink(subject, l),
          },
        ]);
      }
      for (const [groupId, list] of byGroup) {
        await this.notifications.broadcastLessonReminders(groupId, minutesByGroup.get(groupId) ?? 0, list);
      }
    } catch (err) {
      this.logger.error(`tickLessonReminders: ${(err as Error).message}`);
    } finally {
      this.lessonTickRunning = false;
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

function formatLocalDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
