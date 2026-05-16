import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QueueStatus, Role, ROLE_LEVEL } from '@fice/shared';
import { Queue, QueueDocument } from './queue.schema';
import { QueueSwapRequest, QueueSwapRequestDocument } from './swap-request.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { User, UserDocument } from '../users/user.schema';
import { BotService } from '../bot/bot.service';
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
};

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

  async listOpen(groupId: string): Promise<QueueDocument[]> {
    const now = new Date();
    const all = await this.queues
      .find({ groupId: new Types.ObjectId(groupId) })
      .sort({ createdAt: -1 })
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
    const subject = await this.subjects.findById(subjectId).exec();
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

    let queue = await this.queues
      .findOne({ subjectId: subject._id, groupId: subject.groupId })
      .sort({ createdAt: 1 })
      .exec();

    if (!queue) {
      // Don't auto-create on a teacher's first view — they shouldn't be the
      // queue's creator. Show an empty placeholder until the head opens it.
      if (!isMember) {
        return this.serializeEmptyForTeacher(subject);
      }
      queue = await this.queues.create({
        subjectId: subject._id,
        groupId: subject.groupId,
        title: subject.shortName ?? subject.name,
        slotsCount: 25,
        rules: this.normaliseRules(undefined),
        createdBy: new Types.ObjectId(user.userId),
      });
      this.logger.log(`Auto-created queue for subject ${subjectId} by user ${user.userId}`);
    }
    return this.serializeForUser(queue, user, isSubjectTeacher);
  }

  /** Empty placeholder for subject-teachers when the head hasn't opened the queue yet. */
  private serializeEmptyForTeacher(subject: SubjectDocument): unknown {
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
    const toUsers = await this.users.find({ _id: { $in: toIds } }).lean().exec();
    const nameById = new Map(
      toUsers.map((u) => [
        String(u._id),
        u.fullName?.trim() ||
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.username ||
          'Користувач',
      ]),
    );
    return swaps.map((s) => ({
      _id: String(s._id),
      toUserId: String(s.toUserId),
      toFullName: nameById.get(String(s.toUserId)) ?? 'Користувач',
      fromSlotIndex: s.fromSlotIndex,
      toSlotIndex: s.toSlotIndex,
    }));
  }

  async listIncomingSwaps(user: RequestUser, queueId: string): Promise<
    Array<{ _id: string; fromUserId: string; fromFullName: string; fromSlotIndex: number; toSlotIndex: number }>
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
    const fromUsers = await this.users.find({ _id: { $in: fromIds } }).lean().exec();
    const nameById = new Map(
      fromUsers.map((u) => [
        String(u._id),
        u.fullName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || 'Користувач',
      ]),
    );
    return swaps.map((s) => ({
      _id: String(s._id),
      fromUserId: String(s.fromUserId),
      fromFullName: nameById.get(String(s.fromUserId)) ?? 'Користувач',
      fromSlotIndex: s.fromSlotIndex,
      toSlotIndex: s.toSlotIndex,
    }));
  }

  private async serializeForUser(
    q: QueueDocument,
    user: RequestUser,
    isSubjectTeacher = false,
  ): Promise<unknown> {
    const membership = user.memberships.find((m) => m.groupId === String(q.groupId));
    // If the user is on the subject's teachers list (without group membership),
    // surface them as `teacher` so the UI renders read-only.
    const myRole = membership?.role ?? (isSubjectTeacher ? Role.Teacher : Role.Student);
    const userIds = q.entries.map((e) => e.userId).filter(Boolean);
    const users = await this.users.find({ _id: { $in: userIds } }).lean().exec();
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
        };
      });
      return { slotIndex: idx, occupants };
    });
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
    };
  }

  private liveStatus(q: QueueDocument): 'draft' | 'open' | 'closed' {
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
    const q = await this.findById(id);
    this.assertCanManage(user, String(q.groupId));

    const wasOpen = this.liveStatus(q) === 'open';

    if (dto.title !== undefined) q.title = dto.title;
    if (dto.slotsCount !== undefined) {
      if (q.entries.some((e) => e.slotIndex > dto.slotsCount!)) {
        throw new BadRequestException('Cannot shrink below occupied slots');
      }
      q.slotsCount = dto.slotsCount;
    }
    if (dto.rules) q.rules = { ...q.rules, ...this.normaliseRules(dto.rules) };
    await q.save();

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
   *   • Telegram DM to every group member who has `dmQueueOpen=true` in prefs.
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
      .collection('notification_prefs')
      .find({ userId: { $in: members.map((m) => m._id) } })
      .toArray();
    const optInMap = new Map<string, boolean>(
      prefsByUser.map((p) => [String(p.userId), p.dmQueueOpen !== false]),
    );

    const dmText =
      `<b>🔔 Черга відкрилась</b>\n\n` +
      `«${escapeHtml(q.title)}» — можна записуватись.\n` +
      `Відкрийте FICE Helper, щоб обрати місце.`;

    for (const m of members) {
      if (!m.telegramId) continue;
      // Default = opt-in: if user never opened settings, prefs row may not exist
      // → treat as "send" (matches schema default true).
      const optedIn = optInMap.get(String(m._id)) ?? true;
      if (!optedIn) continue;
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

  async enroll(user: RequestUser, queueId: string, dto: EnrollDto): Promise<QueueDocument> {
    const q = await this.findById(queueId);
    this.assertMember(user, String(q.groupId));
    this.ensureOpen(q);

    this.assertSlotAvailable(q, dto.slotIndex);
    if (!q.rules.allowMultipleEntriesPerUser) {
      if (q.entries.some((e) => String(e.userId) === user.userId)) {
        throw new BadRequestException('You are already enrolled');
      }
    }

    const profileComplete = await this.assertProfileComplete(user.userId);
    if (!profileComplete) {
      throw new BadRequestException('Fill full name in profile before enrolling');
    }

    q.entries.push({
      slotIndex: dto.slotIndex,
      userId: new Types.ObjectId(user.userId),
      labNumber: dto.labNumber,
      status: QueueStatus.Default,
      enrolledAt: new Date(),
    });
    await q.save();
    return q;
  }

  async adminEnroll(user: RequestUser, queueId: string, dto: AdminEnrollDto): Promise<QueueDocument> {
    const q = await this.findById(queueId);
    this.assertCanManage(user, String(q.groupId));
    this.assertSlotAvailable(q, dto.slotIndex);
    q.entries.push({
      slotIndex: dto.slotIndex,
      userId: new Types.ObjectId(dto.userId),
      labNumber: dto.labNumber,
      status: QueueStatus.Default,
      enrolledAt: new Date(),
    });
    await q.save();
    return q;
  }

  async leave(user: RequestUser, queueId: string, slotIndex: number): Promise<QueueDocument> {
    const q = await this.findById(queueId);
    const entry = q.entries.find((e) => e.slotIndex === slotIndex);
    if (!entry) throw new NotFoundException('Entry not found');
    const isOwner = String(entry.userId) === user.userId;
    const canManage = this.hasManage(user, String(q.groupId));
    if (!isOwner && !canManage) throw new ForbiddenException();

    q.entries = q.entries.filter((e) => !(e.slotIndex === slotIndex && String(e.userId) === String(entry.userId)));
    await q.save();
    return q;
  }

  async updateEntry(
    user: RequestUser,
    queueId: string,
    slotIndex: number,
    dto: UpdateEntryDto,
  ): Promise<QueueDocument> {
    const q = await this.findById(queueId);
    const entry = q.entries.find((e) => e.slotIndex === slotIndex);
    if (!entry) throw new NotFoundException('Entry not found');

    const isOwner = String(entry.userId) === user.userId;
    const canManage = this.hasManage(user, String(q.groupId));

    if (dto.status !== undefined && !canManage) {
      throw new ForbiddenException('Only head/deputy/teacher can change status');
    }
    if (!isOwner && !canManage) throw new ForbiddenException();

    if (dto.labNumber !== undefined) entry.labNumber = dto.labNumber;

    const oldStatus = entry.status;
    if (dto.status !== undefined) entry.status = dto.status;

    // Auto-cascade status changes through the queue: when status TRANSITIONS
    // to a "moving" state, promote the next eligible slot. Only fires on
    // genuine transitions (oldStatus !== newStatus) — re-saving the same
    // status doesn't re-fire DMs.
    const promoted = (dto.status !== undefined && dto.status !== oldStatus)
      ? this.advanceQueueChain(q, slotIndex, dto.status, oldStatus)
      : [];

    await q.save();

    // DM promoted users — fire-and-forget so the request stays fast.
    for (const p of promoted) {
      void this.notifyChainPromotion(p, q).catch((err) =>
        this.logger.warn(`queue chain DM failed: ${(err as Error).message}`),
      );
    }
    return q;
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
  ): Array<{ slotIndex: number; userId: Types.ObjectId; toStatus: QueueStatus }> {
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
    next.status = preparing;
    return next.userId
      ? [{ slotIndex: next.slotIndex, userId: next.userId, toStatus: preparing }]
      : [];
  }

  /** DM a user that the queue advanced and they're now `preparing`. */
  private async notifyChainPromotion(
    p: { slotIndex: number; userId: Types.ObjectId; toStatus: QueueStatus },
    q: QueueDocument,
  ): Promise<void> {
    const u = await this.users.findById(p.userId).lean().exec();
    if (!u?.telegramId) return;

    // Honour `dmNextInQueue` notification preference.
    const prefs = await this.swaps.db
      .collection('notification_prefs')
      .findOne({ userId: new Types.ObjectId(String(u._id)) });
    if (prefs && prefs.dmNextInQueue === false) return;

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
    if (existing) {
      throw new BadRequestException(
        'У вас вже є активний запит на обмін у цій черзі. Скасуйте його, щоб надіслати новий.',
      );
    }

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

    const swap = await this.swaps.create({
      queueId: q._id,
      fromUserId: new Types.ObjectId(user.userId),
      toUserId: target.userId,
      fromSlotIndex: own.slotIndex,
      toSlotIndex: target.slotIndex,
      status: 'pending',
    });

    // Telegram DM to the target user
    const [me, them] = await Promise.all([
      this.users.findById(user.userId).lean().exec(),
      this.users.findById(target.userId).lean().exec(),
    ]);
    if (them?.telegramId) {
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
    } else {
      this.logger.warn(`Swap target user ${target.userId} has no telegramId`);
    }

    return swap;
  }

  async respondSwap(user: RequestUser, swapId: string, accept: boolean): Promise<void> {
    const swap = await this.swaps.findById(swapId).exec();
    if (!swap) throw new NotFoundException('Swap not found');
    if (String(swap.toUserId) !== user.userId) throw new ForbiddenException();
    if (swap.status !== 'pending') throw new BadRequestException('Already decided');

    const q = await this.queues.findById(swap.queueId).exec();
    if (!q) throw new NotFoundException('Queue gone');

    if (!accept) {
      swap.status = 'declined';
      await swap.save();
      void this.notifySwapResolved(swap, q, false).catch((err) =>
        this.logger.warn(`swap decline DM failed: ${(err as Error).message}`),
      );
      return;
    }
    const a = q.entries.find((e) => e.slotIndex === swap.fromSlotIndex);
    const b = q.entries.find((e) => e.slotIndex === swap.toSlotIndex);
    if (!a || !b) throw new BadRequestException('Swap no longer valid');
    [a.slotIndex, b.slotIndex] = [b.slotIndex, a.slotIndex];
    await q.save();
    swap.status = 'accepted';
    await swap.save();
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

    await this.swaps.updateMany(
      {
        queueId: new Types.ObjectId(queueId),
        toUserId: new Types.ObjectId(user.userId),
        status: 'pending',
      },
      { $set: { status: 'declined' } },
    );

    // Fire-and-forget DMs to each sender so they know not to wait.
    for (const swap of pending) {
      void this.notifySwapResolved(swap, q as QueueDocument, false).catch((err) =>
        this.logger.warn(`bulk-decline DM failed: ${(err as Error).message}`),
      );
    }
    return { declined: pending.length };
  }

  /**
   * Cancel one's own pending swap request — required so the user can replace
   * it with a new one (since `requestSwap` enforces "at most one pending").
   */
  async cancelMySwap(user: RequestUser, swapId: string): Promise<void> {
    if (!Types.ObjectId.isValid(swapId)) throw new NotFoundException('Swap not found');
    const swap = await this.swaps.findById(swapId).exec();
    if (!swap) throw new NotFoundException('Swap not found');
    if (String(swap.fromUserId) !== user.userId) throw new ForbiddenException();
    if (swap.status !== 'pending') throw new BadRequestException('Already decided');
    swap.status = 'cancelled' as 'declined'; // schema only knows declined; reuse
    await swap.save();
  }

  /**
   * DM the swap's sender that their request was accepted/declined. Respects
   * the user's `dmSwapRequests` notification preference.
   */
  private async notifySwapResolved(
    swap: QueueSwapRequestDocument,
    q: QueueDocument,
    accepted: boolean,
  ): Promise<void> {
    const fromUser = await this.users.findById(swap.fromUserId).lean().exec();
    if (!fromUser?.telegramId) return;

    // Honour user's DM preference for swap-related events.
    const prefs = await this.swaps.db
      .collection('notification_prefs')
      .findOne({ userId: new Types.ObjectId(String(fromUser._id)) });
    if (prefs && prefs.dmSwapRequests === false) return;

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
