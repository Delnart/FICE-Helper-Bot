import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, Model, Types } from 'mongoose';
import { QueueStatus, Role, ROLE_LEVEL } from '@fice/shared';
import { Queue, QueueDocument, QueueEntrySub } from './queue.schema';
import { QueueSwapRequest, QueueSwapRequestDocument } from './swap-request.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { User, UserDocument } from '../users/user.schema';
import { BotService } from '../bot/bot.service';
import { effectivePref, PrefKey, PrefsLike } from '../notifications/notification-prefs.schema';
import { RequestUser } from '../../common/types/request-user';
import {
  AdminEnrollDto,
  CreateQueueDto,
  EnrollDto,
  QueueRulesDto,
  RequestSwapDto,
  UpdateEntryDto,
  UpdateQueueDto,
} from './dto/queue.dto';

type QueueRulesInput = {
  allowMultipleEntriesPerUser?: boolean;
  allowGroupSubmission?: boolean;
  isOpen?: boolean;
  autoOpenAt?: string | Date;
  autoCloseAt?: string | Date;
  autoCompact?: boolean;
};

/** Plain (`.lean()`) or hydrated queue — read-only serializers accept either. */
type LeanQueue = Queue & { _id: Types.ObjectId };

type PrefsRow = PrefsLike & { userId: Types.ObjectId };

type Promotion = { slotIndex: number; userId: Types.ObjectId; toStatus: QueueStatus };

const WAITING: QueueStatus[] = [QueueStatus.Default, QueueStatus.Preparing];
const FINISHED: QueueStatus[] = [QueueStatus.Passed, QueueStatus.Missed, QueueStatus.Failed];

@Injectable()
export class QueuesService {
  private readonly logger = new Logger(QueuesService.name);

  constructor(
    @InjectModel(Queue.name) private readonly queues: Model<QueueDocument>,
    @InjectModel(QueueSwapRequest.name) private readonly swaps: Model<QueueSwapRequestDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly bot: BotService,
  ) {}

  async list(groupId: string, subjectId?: string): Promise<QueueDocument[]> {
    const filter: Record<string, unknown> = { groupId: new Types.ObjectId(groupId) };
    if (subjectId && Types.ObjectId.isValid(subjectId)) {
      filter.subjectId = new Types.ObjectId(subjectId);
    } else if (subjectId) {
      return [];
    }
    return this.queues.find(filter).sort({ createdAt: -1 }).exec();
  }

  async listOpen(groupId: string): Promise<LeanQueue[]> {
    const now = new Date();
    const all = await this.queues
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return all.filter((q) => {
      let open = q.rules.isOpen;
      if (q.rules.autoOpenAt && q.rules.autoOpenAt <= now) open = true;
      if (q.rules.autoCloseAt && q.rules.autoCloseAt <= now) open = false;
      return open;
    });
  }

  async findById(id: string): Promise<QueueDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Queue not found');
    const q = await this.queues.findById(id).exec();
    if (!q) throw new NotFoundException('Queue not found');
    return q;
  }

  async findByIdForUser(user: RequestUser, id: string): Promise<unknown> {
    const q = await this.findById(id);
    // If the user isn't a group member, allow access only when they're a
    // teacher on the queue's subject (so the read-only view loads).
    const isMember = user.memberships.some((m) => m.groupId === String(q.groupId));
    let isSubjectTeacher = false;
    if (!isMember) {
      const subject = await this.subjects.findById(q.subjectId).lean().exec();
      isSubjectTeacher = !!subject?.teachers.some(
        (t) => t.teacherUserId && String(t.teacherUserId) === user.userId,
      );
      if (!isSubjectTeacher) {
        throw new ForbiddenException('You are not a member of this group');
      }
    }
    return this.serializeForUser(q, user, isSubjectTeacher);
  }

  async findOrCreateForSubject(user: RequestUser, subjectId: string): Promise<unknown> {
    if (!Types.ObjectId.isValid(subjectId)) throw new NotFoundException('Subject not found');
    const subject = await this.subjects
      .findById(subjectId, { groupId: 1, name: 1, shortName: 1, 'teachers.teacherUserId': 1 })
      .lean()
      .exec();
    if (!subject) throw new NotFoundException('Subject not found');

    // Group members get full access; teachers listed on this specific subject
    // get read-only viewing rights even if they aren't group members yet.
    const isMember = user.memberships.some(
      (m) => m.groupId === String(subject.groupId),
    );
    const isSubjectTeacher = subject.teachers.some(
      (t) => t.teacherUserId && String(t.teacherUserId) === user.userId,
    );
    if (!isMember && !isSubjectTeacher) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const findQueue = () =>
      this.queues
        .findOne({ subjectId: subject._id, groupId: subject.groupId })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
    let queue: LeanQueue | null = await findQueue();

    if (!queue) {
      // Don't auto-create on a teacher's first view — they shouldn't be the
      // queue's creator. Show an empty placeholder until the head opens it.
      if (!isMember) {
        return this.serializeEmptyForTeacher(subject);
      }
      try {
        queue = await this.queues.create({
          subjectId: subject._id,
          groupId: subject.groupId,
          title: subject.shortName ?? subject.name,
          slotsCount: 25,
          rules: this.normaliseRules(undefined),
          createdBy: new Types.ObjectId(user.userId),
        });
        this.logger.log(`Auto-created queue for subject ${subjectId} by user ${user.userId}`);
      } catch (err) {
        // A parallel first view won the insert (unique {subjectId, groupId}):
        // serve its queue so both callers see the same one.
        if (!isDuplicateKey(err)) throw err;
        queue = await findQueue();
        if (!queue) throw err;
      }
    }
    return this.serializeForUser(queue, user, isSubjectTeacher);
  }

  /** Empty placeholder for subject-teachers when the head hasn't opened the queue yet. */
  private serializeEmptyForTeacher(
    subject: Pick<Subject, 'name' | 'shortName'> & { _id: Types.ObjectId },
  ): unknown {
    return {
      _id: '',
      title: subject.shortName ?? subject.name,
      subjectId: String(subject._id),
      slotsCount: 0,
      status: 'closed',
      rules: this.normaliseRules(undefined),
      slots: [],
      myRole: Role.Teacher,
      myUserId: '',
    };
  }

  /** List the user's own pending OUTGOING swap requests in this queue. */
  async listOutgoingSwaps(
    user: RequestUser,
    queueId: string,
  ): Promise<
    Array<{
      _id: string;
      toUserId: string;
      toFullName: string;
      toAvatarUrl?: string;
      fromSlotIndex: number;
      toSlotIndex: number;
    }>
  > {
    if (!Types.ObjectId.isValid(queueId)) return [];
    const swaps = await this.swaps
      .find({
        queueId: new Types.ObjectId(queueId),
        fromUserId: new Types.ObjectId(user.userId),
        status: 'pending',
      })
      .lean()
      .exec();
    if (swaps.length === 0) return [];
    const toIds = swaps.map((s) => s.toUserId);
    const toUsers = await this.users
      .find({ _id: { $in: toIds } }, { fullName: 1, firstName: 1, lastName: 1, username: 1, avatarUrl: 1 })
      .lean()
      .exec();
    const nameById = new Map(
      toUsers.map((u) => [
        String(u._id),
        u.fullName?.trim() ||
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.username ||
          'Користувач',
      ]),
    );
    const avatarById = new Map(toUsers.map((u) => [String(u._id), u.avatarUrl]));
    return swaps.map((s) => ({
      _id: String(s._id),
      toUserId: String(s.toUserId),
      toFullName: nameById.get(String(s.toUserId)) ?? 'Користувач',
      toAvatarUrl: avatarById.get(String(s.toUserId)),
      fromSlotIndex: s.fromSlotIndex,
      toSlotIndex: s.toSlotIndex,
    }));
  }

  async listIncomingSwaps(user: RequestUser, queueId: string): Promise<
    Array<{
      _id: string;
      fromUserId: string;
      fromFullName: string;
      fromAvatarUrl?: string;
      fromSlotIndex: number;
      toSlotIndex: number;
    }>
  > {
    if (!Types.ObjectId.isValid(queueId)) return [];
    const swaps = await this.swaps
      .find({
        queueId: new Types.ObjectId(queueId),
        toUserId: new Types.ObjectId(user.userId),
        status: 'pending',
      })
      .lean()
      .exec();
    if (swaps.length === 0) return [];
    const fromIds = swaps.map((s) => s.fromUserId);
    const fromUsers = await this.users
      .find({ _id: { $in: fromIds } }, { fullName: 1, firstName: 1, lastName: 1, username: 1, avatarUrl: 1 })
      .lean()
      .exec();
    const nameById = new Map(
      fromUsers.map((u) => [
        String(u._id),
        u.fullName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || 'Користувач',
      ]),
    );
    const avatarById = new Map(fromUsers.map((u) => [String(u._id), u.avatarUrl]));
    return swaps.map((s) => ({
      _id: String(s._id),
      fromUserId: String(s.fromUserId),
      fromFullName: nameById.get(String(s.fromUserId)) ?? 'Користувач',
      fromAvatarUrl: avatarById.get(String(s.fromUserId)),
      fromSlotIndex: s.fromSlotIndex,
      toSlotIndex: s.toSlotIndex,
    }));
  }

  private async serializeForUser(
    q: LeanQueue,
    user: RequestUser,
    isSubjectTeacher = false,
  ): Promise<unknown> {
    const membership = user.memberships.find((m) => m.groupId === String(q.groupId));
    // If the user is on the subject's teachers list (without group membership),
    // surface them as `teacher` so the UI renders read-only.
    const myRole = membership?.role ?? (isSubjectTeacher ? Role.Teacher : Role.Student);
    const userIds = q.entries.map((e) => e.userId).filter(Boolean);
    const users = await this.users
      .find(
        { _id: { $in: userIds } },
        { fullName: 1, firstName: 1, lastName: 1, username: 1, avatarUrl: 1 },
      )
      .lean()
      .exec();
    const userMap = new Map(
      users.map((u) => [
        String(u._id),
        {
          fullName:
            u.fullName?.trim() ||
            [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
            u.username ||
            '',
          avatarUrl: u.avatarUrl,
          username: u.username,
        },
      ]),
    );
    const slots = Array.from({ length: q.slotsCount }, (_, i) => {
      const idx = i + 1;
      const entries = q.entries.filter((e) => e.slotIndex === idx);
      const occupants = entries.map((entry) => {
        const u = entry.userId ? userMap.get(String(entry.userId)) : undefined;
        return {
          userId: entry.userId ? String(entry.userId) : null,
          fullName: u?.fullName ?? '',
          avatarUrl: u?.avatarUrl,
          username: u?.username,
          labNumber: entry.labNumber,
          status: entry.status ?? QueueStatus.Default,
          enrolledAt: entry.enrolledAt,
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt,
        };
      });
      return { slotIndex: idx, occupants };
    });
    // Teachers see several groups' queues, so their header names the group.
    const group =
      myRole === Role.Teacher
        ? await this.swaps.db
            .collection('academic_groups')
            .findOne({ _id: q.groupId }, { projection: { academicName: 1 } })
        : null;
    return {
      _id: String(q._id),
      title: q.title,
      subjectId: String(q.subjectId),
      slotsCount: q.slotsCount,
      status: this.liveStatus(q),
      rules: q.rules,
      slots,
      myRole,
      myUserId: user.userId,
      groupName: (group?.academicName as string | undefined) ?? undefined,
      avgPassMs: q.passedCount ? Math.round(q.passedMsTotal / q.passedCount) : null,
    };
  }

  private liveStatus(q: Pick<Queue, 'rules'>): 'draft' | 'open' | 'closed' {
    const now = new Date();
    let open = q.rules.isOpen;
    if (q.rules.autoOpenAt && q.rules.autoOpenAt <= now) open = true;
    if (q.rules.autoCloseAt && q.rules.autoCloseAt <= now) open = false;
    return open ? 'open' : 'closed';
  }

  async create(user: RequestUser, dto: CreateQueueDto): Promise<QueueDocument> {
    const subject = await this.subjects.findById(dto.subjectId).exec();
    if (!subject) throw new NotFoundException('Subject not found');

    this.assertCanManage(user, String(subject.groupId));

    return this.queues.create({
      subjectId: subject._id,
      groupId: subject.groupId,
      title: dto.title,
      slotsCount: dto.slotsCount,
      rules: this.normaliseRules(dto.rules),
      createdBy: new Types.ObjectId(user.userId),
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateQueueDto): Promise<QueueDocument> {
    let wasOpen = false;
    const q = await this.mutateQueue(id, (q) => {
      this.assertCanManage(user, String(q.groupId));

      wasOpen = this.liveStatus(q) === 'open';

      if (dto.title !== undefined) q.title = dto.title;
      if (dto.slotsCount !== undefined) {
        if (q.entries.some((e) => e.slotIndex > dto.slotsCount!)) {
          throw new BadRequestException('Cannot shrink below occupied slots');
        }
        q.slotsCount = dto.slotsCount;
      }
      if (dto.rules) q.rules = { ...q.rules, ...this.normaliseRules(dto.rules) };
    });

    const isOpenNow = this.liveStatus(q) === 'open';
    // Transition closed → open → fire DM + group chat notification.
    // Fire-and-forget so the API response stays fast.
    if (!wasOpen && isOpenNow) {
      void this.dispatchQueueOpenNotifications(q).catch((err) =>
        this.logger.warn(`queue-open dispatch failed: ${(err as Error).message}`),
      );
    }
    return q;
  }

  /**
   * Announce a freshly-opened queue:
   *   • Telegram DM to every group member whose `dmQueueOpen` is on for this group.
   *   • One message in the group chat if `group.notificationsEnabled=true`.
   * Both channels are best-effort — one failing doesn't stop the other.
   */
  private async dispatchQueueOpenNotifications(q: QueueDocument): Promise<void> {
    const groupId = q.groupId;
    const group = await this.swaps.db
      .collection('academic_groups')
      .findOne({ _id: groupId });
    if (!group) return;

    // 1. Group chat announcement.
    if (group.notificationsEnabled !== false && group.telegramChatId) {
      const opts: Record<string, unknown> = {};
      if (group.messageThreadId) opts.message_thread_id = group.messageThreadId;
      await this.bot
        .sendMessage(
          group.telegramChatId as number,
          `<b>🔔 Черга «${escapeHtml(q.title)}» відкрита</b>\n` +
            `Заходьте в FICE Helper і записуйтесь.`,
          opts,
        )
        .catch((err) =>
          this.logger.warn(`group chat queue-open failed: ${(err as Error).message}`),
        );
    }

    // 2. DM each member who opted in.
    const members = await this.users
      .find({ 'memberships.groupId': groupId }, { _id: 1, telegramId: 1 })
      .lean()
      .exec();
    if (members.length === 0) return;

    const prefsByUser = await this.swaps.db
      .collection<PrefsRow>('notification_prefs')
      .find({ userId: { $in: members.map((m) => m._id) } }, { projection: { userId: 1, dmQueueOpen: 1, groups: 1 } })
      .toArray();
    const prefsMap = new Map(prefsByUser.map((p) => [String(p.userId), p]));

    const dmText =
      `<b>🔔 Черга відкрилась</b>\n\n` +
      `«${escapeHtml(q.title)}» — можна записуватись.\n` +
      `Відкрийте FICE Helper, щоб обрати місце.`;

    for (const m of members) {
      if (!m.telegramId) continue;
      // No prefs row (never opened settings) → the default, i.e. send.
      if (!effectivePref(prefsMap.get(String(m._id)), groupId, 'dmQueueOpen')) continue;
      await this.bot
        .sendMessage(m.telegramId, dmText)
        .catch((err) =>
          this.logger.warn(`queue-open DM to ${m.telegramId} failed: ${(err as Error).message}`),
        );
    }
  }

  async remove(user: RequestUser, id: string): Promise<void> {
    const q = await this.findById(id);
    this.assertCanManage(user, String(q.groupId));
    await this.queues.deleteOne({ _id: q._id });
  }

  /**
   * Load → check + mutate → save, where save() is a compare-and-swap on __v
   * (schema has optimisticConcurrency). If someone else wrote in between we
   * retry from a fresh load, so `fn` must run ALL its checks against the doc
   * it's given and must not have side effects (it may run more than once).
   */
  // ponytail: retry-on-conflict, a burst of N simultaneous writers on one queue
  // can still 409 the tail; enrolls (the real burst) go through pushEntry instead.
  private async mutateQueue(
    queueId: string,
    fn: (q: QueueDocument) => void,
    attempts = 5,
  ): Promise<QueueDocument> {
    for (let i = 1; ; i++) {
      const q = await this.findById(queueId);
      fn(q);
      try {
        await q.save();
        return q;
      } catch (err) {
        if (!(err instanceof MongooseError.VersionError)) throw err;
        if (i >= attempts) {
          throw new ConflictException('Черга щойно змінилась — спробуйте ще раз');
        }
      }
    }
  }

  async enroll(user: RequestUser, queueId: string, dto: EnrollDto): Promise<QueueDocument> {
    // Thrown after the queue checks so error precedence is unchanged.
    const profileComplete = await this.assertProfileComplete(user.userId);

    return this.pushEntry(queueId, user.userId, dto, true, (q) => {
      this.assertMember(user, String(q.groupId));
      this.ensureOpen(q);

      this.assertSlotAvailable(q, dto.slotIndex);
      if (!q.rules.allowMultipleEntriesPerUser) {
        if (q.entries.some((e) => String(e.userId) === user.userId)) {
          throw new BadRequestException('You are already enrolled');
        }
      }

      if (!profileComplete) {
        throw new BadRequestException('Fill full name in profile before enrolling');
      }
    });
  }

  async adminEnroll(user: RequestUser, queueId: string, dto: AdminEnrollDto): Promise<QueueDocument> {
    // Managers may still place one person twice (never enforced here before).
    return this.pushEntry(queueId, dto.userId, dto, false, async (q) => {
      this.assertCanManage(user, String(q.groupId));
      this.assertSlotAvailable(q, dto.slotIndex);
      const member = await this.users
        .exists({
          _id: new Types.ObjectId(dto.userId),
          'memberships.groupId': new Types.ObjectId(String(q.groupId)),
        })
        .exec();
      if (!member) throw new BadRequestException('User is not a member of this group');
    });
  }

  /**
   * Enroll as ONE conditional $push: the slot / one-entry rules are re-checked
   * by Mongo on the stored doc, so a burst of students taking different slots
   * all land (the CAS loop 409'd most of them). $inc __v keeps mutateQueue's
   * CAS saves from overwriting the push. `check` runs on a fresh read first
   * for the precise error; rules are read there, so a rules edit racing this
   * call evaluates this one request with the old rules.
   */
  private async pushEntry(
    queueId: string,
    userId: string,
    dto: EnrollDto,
    oneEntryPerUser: boolean,
    check: (q: QueueDocument) => void | Promise<void>,
  ): Promise<QueueDocument> {
    const uid = new Types.ObjectId(userId);
    // Normally 1 round. A null update means someone raced us: the next read's
    // check throws the real reason; if it passes (that entry left / rules
    // changed) the push is simply retried.
    for (let i = 1; ; i++) {
      const q = await this.findById(queueId);
      await check(q);
      if (i > 2) throw new ConflictException('Черга щойно змінилась — спробуйте ще раз');
      const filter: Record<string, unknown> = { _id: q._id, slotsCount: { $gte: dto.slotIndex } };
      if (!q.rules.allowGroupSubmission) filter['entries.slotIndex'] = { $ne: dto.slotIndex };
      if (oneEntryPerUser && !q.rules.allowMultipleEntriesPerUser) {
        filter['entries.userId'] = { $ne: uid };
      }
      const updated = await this.queues
        .findOneAndUpdate(
          filter,
          {
            $push: {
              entries: {
                slotIndex: dto.slotIndex,
                userId: uid,
                labNumber: dto.labNumber,
                status: QueueStatus.Default,
                enrolledAt: new Date(),
              },
            },
            $inc: { __v: 1 },
          },
          { new: true },
        )
        .exec();
      if (updated) return updated;
    }
  }

  async leave(
    user: RequestUser,
    queueId: string,
    slotIndex: number,
    userId?: string,
  ): Promise<QueueDocument> {
    return this.mutateQueue(queueId, (q) => {
      const entry = this.pickEntry(q, slotIndex, user, userId);
      this.assertOwnerOrManager(user, String(q.groupId), String(entry.userId));

      q.entries = q.entries.filter((e) => !(e.slotIndex === slotIndex && String(e.userId) === String(entry.userId)));
    });
  }

  async updateEntry(
    user: RequestUser,
    queueId: string,
    slotIndex: number,
    dto: UpdateEntryDto,
  ): Promise<QueueDocument> {
    let promoted: Promotion[] = [];
    let slotMap = null as Map<number, number> | null;
    const q = await this.mutateQueue(queueId, (q) => {
      const entry = this.pickEntry(q, slotIndex, user, dto.userId);

      const canManage = this.hasManage(user, String(q.groupId));

      if (dto.status !== undefined && !canManage) {
        throw new ForbiddenException('Only head/deputy/teacher can change status');
      }
      this.assertOwnerOrManager(user, String(q.groupId), String(entry.userId));

      if (dto.labNumber !== undefined) entry.labNumber = dto.labNumber;

      const oldStatus = entry.status;
      if (dto.status !== undefined) this.setEntryStatus(q, entry, dto.status);

      // Auto-cascade status changes through the queue: when status TRANSITIONS
      // to a "moving" state, promote the next eligible slot. Only fires on
      // genuine transitions (oldStatus !== newStatus) — re-saving the same
      // status doesn't re-fire DMs.
      const changed = dto.status !== undefined && dto.status !== oldStatus;
      promoted = changed ? this.advanceQueueChain(q, slotIndex, dto.status!, oldStatus) : [];
      slotMap =
        changed && dto.status === QueueStatus.Passed && q.rules.autoCompact
          ? this.compactEntries(q, [QueueStatus.Passed])
          : null;
    });

    await this.afterStatusWrite(q, promoted, slotMap);
    return q;
  }

  /**
   * The entry at `slotIndex` a write acts on. `userId` (sent by the client for the
   * person it shows) pins it: in a shared slot it picks the right teammate, and
   * after a compaction moved people it refuses instead of hitting whoever moved in.
   * Without it: the caller's own entry, else the first one.
   */
  private pickEntry(
    q: QueueDocument,
    slotIndex: number,
    user: RequestUser,
    userId?: string,
  ): QueueEntrySub {
    const inSlot = q.entries.filter((e) => e.slotIndex === slotIndex);
    if (userId) {
      const entry = inSlot.find((e) => String(e.userId) === userId);
      if (!entry) throw new ConflictException('Черга щойно змінилась — спробуйте ще раз');
      return entry;
    }
    const entry = inSlot.find((e) => String(e.userId) === user.userId) ?? inSlot[0];
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }

  /**
   * "Наступний →": the lowest `passing` slot becomes `passed`, the first waiting
   * slot after it becomes `passing`, and advanceQueueChain marks the one after
   * that `preparing` (+ the usual DM). A shared slot moves as one.
   */
  async advance(user: RequestUser, queueId: string): Promise<QueueDocument> {
    let promoted: Promotion[] = [];
    let slotMap = null as Map<number, number> | null;
    const q = await this.mutateQueue(queueId, (q) => {
      this.assertCanManage(user, String(q.groupId));
      const sorted = [...q.entries].sort((a, b) => a.slotIndex - b.slotIndex);
      const current = sorted.find((e) => e.status === QueueStatus.Passing)?.slotIndex;
      const next = sorted.find(
        (e) => e.slotIndex > (current ?? 0) && WAITING.includes(e.status),
      )?.slotIndex;
      if (current === undefined && next === undefined) {
        throw new BadRequestException('У черзі більше немає кого викликати');
      }
      for (const e of sorted) {
        if (e.slotIndex === current && e.status === QueueStatus.Passing) {
          this.setEntryStatus(q, e, QueueStatus.Passed);
        } else if (e.slotIndex === next && WAITING.includes(e.status)) {
          this.setEntryStatus(q, e, QueueStatus.Passing);
        }
      }
      promoted =
        next !== undefined
          ? this.advanceQueueChain(q, next, QueueStatus.Passing, QueueStatus.Default)
          : [];
      slotMap =
        current !== undefined && q.rules.autoCompact
          ? this.compactEntries(q, [QueueStatus.Passed])
          : null;
    });
    await this.afterStatusWrite(q, promoted, slotMap);
    return q;
  }

  /** "Підтягнути чергу": drop finished entries, everyone below moves up (like deleting sheet rows). */
  async compact(user: RequestUser, queueId: string, statuses: QueueStatus[]): Promise<QueueDocument> {
    let slotMap = null as Map<number, number> | null;
    const q = await this.mutateQueue(queueId, (q) => {
      this.assertCanManage(user, String(q.groupId));
      slotMap = this.compactEntries(q, statuses);
    });
    await this.afterStatusWrite(q, [], slotMap);
    return q;
  }

  /**
   * Every status write goes through here: stamps when someone started/finished
   * passing and feeds the queue's average pass time (the ETA on the client).
   */
  private setEntryStatus(q: QueueDocument, e: QueueEntrySub, status: QueueStatus): void {
    if (e.status === status) return;
    const now = new Date();
    if (status === QueueStatus.Passing) {
      e.startedAt = now;
      e.finishedAt = undefined;
    } else if (FINISHED.includes(status)) {
      if (e.status === QueueStatus.Passing && e.startedAt && status !== QueueStatus.Missed) {
        const ms = now.getTime() - new Date(e.startedAt).getTime();
        // ponytail: drops runs <30 s (double tap) and >1 h (forgotten tap); a median if this skews.
        if (ms >= 30_000 && ms <= 3_600_000) {
          q.passedCount = (q.passedCount ?? 0) + 1;
          q.passedMsTotal = (q.passedMsTotal ?? 0) + ms;
        }
      }
      if (!e.finishedAt) e.finishedAt = now;
    } else {
      e.startedAt = undefined;
      e.finishedAt = undefined;
    }
    e.status = status;
  }

  /**
   * Spreadsheet-style "delete rows": drops entries with `statuses` and renumbers
   * the rest 1..n in order (a shared slot stays shared). Returns old → new slot
   * of the survivors, or null when nothing changed.
   */
  private compactEntries(q: QueueDocument, statuses: QueueStatus[]): Map<number, number> | null {
    const keep = q.entries.filter((e) => !statuses.includes(e.status));
    const slotMap = new Map<number, number>();
    for (const s of [...new Set(keep.map((e) => e.slotIndex))].sort((a, b) => a - b)) {
      slotMap.set(s, slotMap.size + 1);
    }
    const moved = [...slotMap].some(([from, to]) => from !== to);
    if (keep.length === q.entries.length && !moved) return null;
    for (const e of keep) e.slotIndex = slotMap.get(e.slotIndex)!;
    q.entries = keep;
    return slotMap;
  }

  /** After the winning save only, so a CAS retry never double-DMs or double-remaps. */
  private async afterStatusWrite(
    q: QueueDocument,
    promoted: Promotion[],
    slotMap: Map<number, number> | null,
  ): Promise<void> {
    if (slotMap) {
      for (const p of promoted) p.slotIndex = slotMap.get(p.slotIndex) ?? p.slotIndex;
      // The queue is already saved; a failed remap only leaves swaps that
      // respondSwap's position check rejects (and expires) later.
      await this.remapSwaps(q, slotMap).catch((err) =>
        this.logger.warn(`swap remap failed: ${(err as Error).message}`),
      );
    }
    // DM promoted users — fire-and-forget so the request stays fast.
    for (const p of promoted) {
      void this.notifyChainPromotion(p, q).catch((err) =>
        this.logger.warn(`queue chain DM failed: ${(err as Error).message}`),
      );
    }
  }

  /** Pending swaps follow their people to the compacted slots; ones whose person left expire. */
  private async remapSwaps(q: QueueDocument, slotMap: Map<number, number>): Promise<void> {
    const at = (userId: Types.ObjectId, slot?: number) =>
      slot !== undefined &&
      q.entries.some((e) => e.slotIndex === slot && String(e.userId) === String(userId));
    const pending = await this.swaps.find({ queueId: q._id, status: 'pending' }).lean().exec();
    await Promise.all(
      pending.map((s) => {
        // Sent after the compaction (already new numbers) → nothing to do.
        if (at(s.fromUserId, s.fromSlotIndex) && at(s.toUserId, s.toSlotIndex)) return;
        const from = slotMap.get(s.fromSlotIndex);
        const to = slotMap.get(s.toSlotIndex);
        const update =
          at(s.fromUserId, from) && at(s.toUserId, to)
            ? { fromSlotIndex: from, toSlotIndex: to }
            : { status: 'expired' as const };
        // Matched on the old numbers so a concurrent accept/cancel wins.
        return this.swaps.updateOne(
          { _id: s._id, status: 'pending', fromSlotIndex: s.fromSlotIndex, toSlotIndex: s.toSlotIndex },
          { $set: update },
        );
      }),
    );
  }

  /**
   * Single rule (kept simple after a real-world test ran the queue out of
   * order and the multi-step cascade promoted wrong people):
   *
   *   newStatus = `passing` AND oldStatus !== `passing`
   *     → next eligible occupant becomes `preparing` + DM.
   *
   * Everything else (`passed`/`missed`/`failed`) does NOT cascade — the head
   * keeps explicit control, sets the next "Здає" themselves.
   *
   * "Next eligible" = the strictly-greater slotIndex with an occupant whose
   * status isn't already `passing`, `passed`, `missed`, or `failed`.
   */
  private advanceQueueChain(
    q: QueueDocument,
    fromSlotIndex: number,
    newStatus: QueueStatus,
    oldStatus: QueueStatus,
  ): Promotion[] {
    const passing: QueueStatus = QueueStatus.Passing;
    const preparing: QueueStatus = QueueStatus.Preparing;

    if (newStatus !== passing || oldStatus === passing) return [];

    // Skip any slot that's already past or actively passing — promote the
    // first slot after it that's still in default/preparing.
    const blockingStatuses: QueueStatus[] = [
      QueueStatus.Passing,
      QueueStatus.Passed,
      QueueStatus.Missed,
      QueueStatus.Failed,
    ];
    const next = q.entries
      .filter(
        (e) =>
          e.slotIndex > fromSlotIndex &&
          !!e.userId &&
          !blockingStatuses.includes(e.status as QueueStatus),
      )
      .sort((a, b) => a.slotIndex - b.slotIndex)[0];

    if (!next || next.status === preparing) return [];
    this.setEntryStatus(q, next, preparing);
    return next.userId
      ? [{ slotIndex: next.slotIndex, userId: next.userId, toStatus: preparing }]
      : [];
  }

  /** DM a user that the queue advanced and they're now `preparing`. */
  private async notifyChainPromotion(
    p: Promotion,
    q: QueueDocument,
  ): Promise<void> {
    const u = await this.users.findById(p.userId).lean().exec();
    if (!u?.telegramId) return;

    if (!(await this.wantsDm(u._id, q.groupId, 'dmNextInQueue'))) return;

    // Currently only `preparing` ever gets promoted (status chain simplified
    // after a chaotic queue run — passed/missed/failed no longer cascade).
    const text =
      `<b>Готуйтесь — ви наступний</b>\n\n` +
      `Черга «${escapeHtml(q.title)}», місце ${p.slotIndex}. ` +
      `Попередній починає здавати — підготуйте свої файли.`;
    await this.bot.sendMessage(u.telegramId, text);
  }

  async requestSwap(
    user: RequestUser,
    queueId: string,
    slotIndex: number,
    dto: RequestSwapDto,
  ): Promise<QueueSwapRequestDocument> {
    const q = await this.findById(queueId);
    const own = q.entries.find((e) => e.slotIndex === slotIndex && String(e.userId) === user.userId);
    if (!own) throw new ForbiddenException('You are not at this slot');
    // A stale entry of someone who left the group can't start swaps.
    this.assertMember(user, String(q.groupId));
    const target = q.entries.find((e) => e.slotIndex === dto.targetSlotIndex);
    if (!target) throw new NotFoundException('Target slot is empty');
    if (String(target.userId) === user.userId) throw new BadRequestException('Cannot swap with yourself');

    // Anti-flood: at most one pending swap per (queue, fromUser). Forces the
    // user to either wait for a response, or cancel/replace their previous
    // request — instead of spamming everyone in the queue.
    const existing = await this.swaps
      .findOne({
        queueId: q._id,
        fromUserId: new Types.ObjectId(user.userId),
        status: 'pending',
      })
      .lean()
      .exec();
    if (existing) throw new BadRequestException(ONE_PENDING_SWAP);

    // Same fromUser → same toUser within an hour: silently dedupe so a user
    // can't bypass the limit by cancelling and re-requesting in a tight loop.
    const recentTo = await this.swaps
      .findOne({
        queueId: q._id,
        fromUserId: new Types.ObjectId(user.userId),
        toUserId: target.userId,
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      })
      .lean()
      .exec();
    if (recentTo) {
      throw new BadRequestException(
        'Ви вже надсилали запит цій людині недавно. Спробуйте через годину.',
      );
    }

    const swap = await this.swaps
      .create({
        queueId: q._id,
        fromUserId: new Types.ObjectId(user.userId),
        toUserId: target.userId,
        fromSlotIndex: own.slotIndex,
        toSlotIndex: target.slotIndex,
        status: 'pending',
      })
      .catch((err: unknown) => {
        // A parallel request passed the check above too; the partial unique
        // index {queueId, fromUserId | pending} let only one of them in.
        throw isDuplicateKey(err) ? new BadRequestException(ONE_PENDING_SWAP) : err;
      });

    // Telegram DM to the target user
    const [me, them] = await Promise.all([
      this.users.findById(user.userId).lean().exec(),
      this.users.findById(target.userId).lean().exec(),
    ]);
    if (them?.telegramId && (await this.wantsDm(them._id, q.groupId, 'dmSwapRequests'))) {
      const fromName =
        me?.fullName?.trim() ||
        [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() ||
        me?.username ||
        'Студент';
      const text =
        `<b>Запит на обмін у черзі</b>\n\n` +
        `${escapeHtml(fromName)} пропонує помінятися місцями у черзі «${escapeHtml(q.title)}».\n` +
        `Місце ${own.slotIndex} ↔ Місце ${target.slotIndex}.\n\n` +
        `Відкрийте FICE Helper, щоб прийняти або відхилити.`;
      await this.bot.sendMessage(them.telegramId, text);
    } else if (!them?.telegramId) {
      this.logger.warn(`Swap target user ${target.userId} has no telegramId`);
    }

    return swap;
  }

  async respondSwap(user: RequestUser, swapId: string, accept: boolean): Promise<void> {
    if (!Types.ObjectId.isValid(swapId)) throw new NotFoundException('Swap not found');
    // Claim the decision atomically so an accept can't race a cancel/decline.
    const swap = await this.swaps
      .findOneAndUpdate(
        { _id: swapId, toUserId: new Types.ObjectId(user.userId), status: 'pending' },
        { $set: { status: accept ? 'accepted' : 'declined' } },
        { new: true },
      )
      .exec();
    if (!swap) {
      const s = await this.swaps.findById(swapId, { toUserId: 1 }).lean().exec();
      if (!s) throw new NotFoundException('Swap not found');
      if (String(s.toUserId) !== user.userId) throw new ForbiddenException();
      throw new BadRequestException('Already decided');
    }

    if (!accept) {
      const q = await this.queues.findById(swap.queueId, { title: 1, groupId: 1 }).lean().exec();
      if (!q) throw new NotFoundException('Queue gone');
      void this.notifySwapResolved(swap, q, false).catch((err) =>
        this.logger.warn(`swap decline DM failed: ${(err as Error).message}`),
      );
      return;
    }

    let q: QueueDocument;
    try {
      q = await this.mutateQueue(String(swap.queueId), (q) => {
        // Like requestSwap: a stale entry of someone who left the group can't move.
        this.assertMember(user, String(q.groupId));
        // Both people must still sit where the request recorded them.
        const a = q.entries.find(
          (e) => e.slotIndex === swap.fromSlotIndex && String(e.userId) === String(swap.fromUserId),
        );
        const b = q.entries.find(
          (e) => e.slotIndex === swap.toSlotIndex && String(e.userId) === String(swap.toUserId),
        );
        if (!a || !b) throw new BadRequestException('Swap no longer valid');
        [a.slotIndex, b.slotIndex] = [b.slotIndex, a.slotIndex];
      });
    } catch (err) {
      // The claim already says 'accepted' but no slots moved. Only a swap that
      // can never apply (people moved / queue deleted / accepter left) dies; a
      // 409 or DB error reopens it as before — expiring it would also trip
      // requestSwap's 1-hour same-person dedupe. A re-accept after a save that
      // did land fails the position check above, so reopening is safe.
      const dead =
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException;
      const settle = (status: 'expired' | 'pending') =>
        this.swaps.updateOne({ _id: swap._id, status: 'accepted' }, { $set: { status } });
      // Reopening collides with the one-pending index if the sender sent a new
      // request meanwhile — then this one just expires.
      await settle(dead ? 'expired' : 'pending').catch((e: unknown) => {
        if (!isDuplicateKey(e)) throw e;
        return settle('expired');
      });
      throw err instanceof NotFoundException ? new NotFoundException('Queue gone') : err;
    }
    void this.notifySwapResolved(swap, q, true).catch((err) =>
      this.logger.warn(`swap accept DM failed: ${(err as Error).message}`),
    );
  }

  /**
   * Bulk-decline: receiver presses one button to reject every pending swap
   * request that came to them in this queue. Each sender gets a DM.
   */
  async declineAllIncomingSwaps(
    user: RequestUser,
    queueId: string,
  ): Promise<{ declined: number }> {
    if (!Types.ObjectId.isValid(queueId)) throw new NotFoundException('Queue not found');
    const q = await this.queues.findById(queueId).lean().exec();
    if (!q) throw new NotFoundException('Queue not found');

    const pending = await this.swaps
      .find({
        queueId: new Types.ObjectId(queueId),
        toUserId: new Types.ObjectId(user.userId),
        status: 'pending',
      })
      .exec();
    if (pending.length === 0) return { declined: 0 };

    // Claim each one on status:'pending' so a swap concurrently accepted /
    // cancelled is neither overwritten nor DM'd about.
    const declined: QueueSwapRequestDocument[] = [];
    await Promise.all(
      pending.map(async (swap) => {
        const res = await this.swaps.updateOne(
          { _id: swap._id, status: 'pending' },
          { $set: { status: 'declined' } },
        );
        if (res.modifiedCount > 0) declined.push(swap);
      }),
    );

    // Fire-and-forget DMs to each sender so they know not to wait.
    for (const swap of declined) {
      void this.notifySwapResolved(swap, q, false).catch((err) =>
        this.logger.warn(`bulk-decline DM failed: ${(err as Error).message}`),
      );
    }
    return { declined: declined.length };
  }

  /**
   * Cancel one's own pending swap request — required so the user can replace
   * it with a new one (since `requestSwap` enforces "at most one pending").
   */
  async cancelMySwap(user: RequestUser, swapId: string): Promise<void> {
    if (!Types.ObjectId.isValid(swapId)) throw new NotFoundException('Swap not found');
    // Atomic so a cancel can't clobber a concurrent accept/decline.
    const res = await this.swaps.updateOne(
      { _id: swapId, fromUserId: new Types.ObjectId(user.userId), status: 'pending' },
      { $set: { status: 'cancelled' } },
    );
    if (res.matchedCount > 0) return;
    // Nothing matched — work out which error the caller gets.
    const swap = await this.swaps.findById(swapId, { fromUserId: 1, status: 1 }).lean().exec();
    if (!swap) throw new NotFoundException('Swap not found');
    if (String(swap.fromUserId) !== user.userId) throw new ForbiddenException();
    throw new BadRequestException('Already decided');
  }

  /**
   * DM the swap's sender that their request was accepted/declined. Respects
   * the user's `dmSwapRequests` notification preference.
   */
  private async notifySwapResolved(
    swap: QueueSwapRequestDocument,
    q: Pick<Queue, 'title' | 'groupId'>,
    accepted: boolean,
  ): Promise<void> {
    const fromUser = await this.users.findById(swap.fromUserId).lean().exec();
    if (!fromUser?.telegramId) return;

    if (!(await this.wantsDm(fromUser._id, q.groupId, 'dmSwapRequests'))) return;

    const target = await this.users.findById(swap.toUserId).lean().exec();
    const targetName =
      target?.fullName?.trim() ||
      [target?.firstName, target?.lastName].filter(Boolean).join(' ').trim() ||
      target?.username ||
      'студент';
    const text = accepted
      ? `<b>Обмін підтверджено</b>\n\n` +
        `${escapeHtml(targetName)} погодився на обмін у черзі «${escapeHtml(q.title)}». ` +
        `Ваше нове місце: <b>№${swap.fromSlotIndex}</b> ↔ було <b>№${swap.toSlotIndex}</b>.`
      : `<b>Обмін відхилено</b>\n\n` +
        `${escapeHtml(targetName)} відхилив запит на обмін у черзі «${escapeHtml(q.title)}» ` +
        `(місце ${swap.fromSlotIndex} ↔ ${swap.toSlotIndex}).`;
    await this.bot.sendMessage(fromUser.telegramId, text);
  }

  /**
   * The user's DM preference for this queue's group. Raw collection: the
   * notifications module depends on this one, not the other way round.
   */
  private async wantsDm(userId: unknown, groupId: unknown, key: PrefKey): Promise<boolean> {
    const prefs = await this.swaps.db
      .collection<PrefsRow>('notification_prefs')
      .findOne({ userId: new Types.ObjectId(String(userId)) }, { projection: { [key]: 1, groups: 1 } });
    return effectivePref(prefs, groupId, key);
  }

  private normaliseRules(dto?: QueueRulesInput | QueueRulesDto | undefined): Queue['rules'] {
    const autoOpenAt = dto?.autoOpenAt
      ? dto.autoOpenAt instanceof Date
        ? dto.autoOpenAt
        : new Date(dto.autoOpenAt)
      : undefined;
    const autoCloseAt = dto?.autoCloseAt
      ? dto.autoCloseAt instanceof Date
        ? dto.autoCloseAt
        : new Date(dto.autoCloseAt)
      : undefined;

    return {
      allowMultipleEntriesPerUser: dto?.allowMultipleEntriesPerUser ?? false,
      allowGroupSubmission: dto?.allowGroupSubmission ?? false,
      isOpen: dto?.isOpen ?? true,
      autoOpenAt,
      autoCloseAt,
      autoCompact: dto?.autoCompact ?? false,
    };
  }

  private assertSlotAvailable(q: QueueDocument, slotIndex: number): void {
    if (slotIndex < 1 || slotIndex > q.slotsCount) {
      throw new BadRequestException('Slot out of range');
    }
    const occupied = q.entries.filter((e) => e.slotIndex === slotIndex);
    if (occupied.length > 0 && !q.rules.allowGroupSubmission) {
      throw new BadRequestException('Slot is already taken');
    }
  }

  private ensureOpen(q: QueueDocument): void {
    const now = new Date();
    let isOpen = q.rules.isOpen;
    if (q.rules.autoOpenAt && q.rules.autoOpenAt <= now) isOpen = true;
    if (q.rules.autoCloseAt && q.rules.autoCloseAt <= now) isOpen = false;
    if (!isOpen) throw new BadRequestException('Queue is closed');
  }

  private assertCanManage(user: RequestUser, groupId: string): void {
    if (!this.hasManage(user, groupId)) {
      throw new ForbiddenException('Only head/deputy can manage queues');
    }
  }

  private hasManage(user: RequestUser, groupId: string): boolean {
    const m = user.memberships.find((x) => x.groupId === groupId);
    return !!m && (ROLE_LEVEL[m.role] ?? 0) >= ROLE_LEVEL[Role.DeputyHead];
  }

  /** Managers act on any entry; anyone else only on their own, and only while still a member. */
  private assertOwnerOrManager(user: RequestUser, groupId: string, entryUserId: string): void {
    if (this.hasManage(user, groupId)) return;
    this.assertMember(user, groupId);
    if (entryUserId !== user.userId) throw new ForbiddenException();
  }

  private assertMember(user: RequestUser, groupId: string): void {
    if (!user.memberships.some((m) => m.groupId === groupId)) {
      throw new ForbiddenException('You are not a member of this group');
    }
  }

  private async assertProfileComplete(userId: string): Promise<boolean> {
    const u = await this.users.findById(userId).lean().exec();
    return !!u?.fullName && u.fullName.trim().length > 0;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ONE_PENDING_SWAP =
  'У вас вже є активний запит на обмін у цій черзі. Скасуйте його, щоб надіслати новий.';

/** E11000: a unique index rejected the write (a concurrent request got there first). */
function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 11000;
}
