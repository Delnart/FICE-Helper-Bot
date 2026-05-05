import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
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
  private readonly sentMarks = new Set<string>();

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
    try {
      const now = new Date();
      const day = ((now.getDay() + 6) % 7) + 1;
      const week = await this.campus.refreshWeekParity();
      const groups = await this.groups.find({ notificationsEnabled: true }).exec();
      for (const group of groups) {
        const lessonTargetTime = new Date(now.getTime() + group.lessonReminderMinutes * 60_000);
        const targetMinutes = lessonTargetTime.getHours() * 60 + lessonTargetTime.getMinutes();

        const [lessons, subjects] = await Promise.all([
          this.lessons
            .find({ groupId: group._id, dayOfWeek: day, $or: [{ weekType: 0 }, { weekType: week }] })
            .exec(),
          this.subjects.find({ groupId: group._id }).exec(),
        ]);
        if (lessons.length === 0) continue;
        const subjectLookup = this.buildSubjectLookup(subjects);
        for (const l of lessons) {
          const [h, m] = l.startTime.split(':').map(Number);
          const startMin = h * 60 + m;
          if (startMin !== targetMinutes) continue;

          const reminderDate = formatLocalDateKey(now);
          const claimed = await this.claimLessonReminder(String(group._id), String(l._id), reminderDate);
          if (!claimed) continue;

          const subject = l.subjectId
            ? subjectLookup.byId.get(String(l.subjectId))
            : subjectLookup.byName.get(normalizeName(l.subjectName));
          const link = this.pickReminderLink(subject, l);
          await this.notifications.broadcastLessonReminder({
            groupId: String(group._id),
            subjectName: l.subjectName,
            lessonType: l.type,
            teacherNames: l.teacherNames,
            startTime: l.startTime,
            endTime: l.endTime,
            room: l.room,
            link,
            minutesLeft: group.lessonReminderMinutes,
          });
        }
      }
    } catch (err) {
      this.logger.error(`tickLessonReminders: ${(err as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tickQueueOpens(): Promise<void> {
    const now = new Date();
    const inFive = new Date(now.getTime() + 5 * 60_000);
    const queues = await this.queues
      .find({ 'rules.autoOpenAt': { $gte: now, $lte: inFive } })
      .exec();
    for (const q of queues) {
      const key = `q-open:${q._id}`;
      if (this.sentMarks.has(key)) continue;
      this.sentMarks.add(key);
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

  private buildSubjectLookup(subjects: SubjectDocument[]): {
    byId: Map<string, SubjectDocument>;
    byName: Map<string, SubjectDocument>;
  } {
    const byId = new Map<string, SubjectDocument>();
    const byName = new Map<string, SubjectDocument>();
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
    subject: SubjectDocument | undefined,
    lesson: ScheduleLessonDocument,
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
