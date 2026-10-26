import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { Homework, HomeworkDocument } from './homework.schema';
import { HomeworkCompletion, HomeworkCompletionDocument } from './homework-completion.schema';
import { Subject, SubjectDocument } from '../subjects/subject.schema';
import { CreateHomeworkDto, UpdateHomeworkDto } from './dto/homework.dto';
import { RequestUser } from '../../common/types/request-user';
import { GroupAccessService } from '../../common/access/group-access';

/** Fields the list endpoints read — fetched lean with this projection. */
const LIST_FIELDS = { title: 1, deadline: 1, subjectId: 1, points: 1, teamSize: 1 } as const;
type HomeworkListRow = Pick<Homework, 'title' | 'deadline' | 'subjectId' | 'points' | 'teamSize'> & {
  _id: Types.ObjectId;
};

export interface HomeworkWithDone {
  homework: HomeworkListRow;
  done: boolean;
  doneAt?: Date;
}

@Injectable()
export class HomeworkService {
  constructor(
    @InjectModel(Homework.name) private readonly homework: Model<HomeworkDocument>,
    @InjectModel(HomeworkCompletion.name) private readonly completions: Model<HomeworkCompletionDocument>,
    @InjectModel(Subject.name) private readonly subjects: Model<SubjectDocument>,
    private readonly access: GroupAccessService,
  ) {}

  async create(user: RequestUser, dto: CreateHomeworkDto): Promise<HomeworkDocument> {
    if (!Types.ObjectId.isValid(dto.subjectId)) throw new NotFoundException('Subject not found');
    const subject = await this.subjects.findById(dto.subjectId).exec();
    if (!subject) throw new NotFoundException('Subject not found');
    this.assertCanManage(user, String(subject.groupId));

    return this.homework.create({
      subjectId: subject._id,
      groupId: subject.groupId,
      title: dto.title,
      description: dto.description,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      points: dto.points,
      teamSize: dto.teamSize ?? 1,
      createdBy: new Types.ObjectId(user.userId),
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateHomeworkDto): Promise<HomeworkDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Homework not found');
    const hw = await this.homework.findById(id).exec();
    if (!hw) throw new NotFoundException('Homework not found');
    this.assertCanManage(user, String(hw.groupId));

    if (dto.title !== undefined) hw.title = dto.title;
    if (dto.description !== undefined) hw.description = dto.description;
    if (dto.deadline !== undefined) hw.deadline = new Date(dto.deadline);
    if (dto.points !== undefined) hw.points = dto.points;
    if (dto.teamSize !== undefined) hw.teamSize = dto.teamSize;
    await hw.save();
    return hw;
  }

  async remove(user: RequestUser, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Homework not found');
    const hw = await this.homework.findById(id).exec();
    if (!hw) throw new NotFoundException('Homework not found');
    this.assertCanManage(user, String(hw.groupId));
    await this.homework.deleteOne({ _id: hw._id });
    await this.completions.deleteMany({ homeworkId: hw._id });
  }

  async listBySubject(user: RequestUser, subjectId: string): Promise<Array<Record<string, unknown>>> {
    if (!Types.ObjectId.isValid(subjectId)) return [];
    const subject = await this.subjects.findById(subjectId, { name: 1, groupId: 1 }).lean().exec();
    if (!subject) return [];
    await this.access.assertAccess(user, String(subject.groupId));
    const hw = await this.homework
      .find({ subjectId: subject._id }, LIST_FIELDS)
      .sort({ deadline: 1, createdAt: -1 })
      .lean()
      .exec();
    const completions = await this.attachCompletions(hw, user.userId);
    return completions.map((c) => ({
      _id: String(c.homework._id),
      title: c.homework.title,
      deadline: c.homework.deadline,
      subjectId: String(c.homework.subjectId),
      subjectName: subject.name ?? '',
      points: c.homework.points,
      // lean skips schema defaults; old rows without teamSize hydrated as 1.
      teamSize: c.homework.teamSize ?? 1,
      done: c.done,
    }));
  }

  async listForUserMainScreen(groupId: string, userId: string): Promise<Array<Record<string, unknown>>> {
    const hw = await this.homework
      .find({ groupId: new Types.ObjectId(groupId), teamSize: { $ne: 0 } }, LIST_FIELDS)
      .sort({ deadline: 1 })
      .lean()
      .exec();
    const subjects = await this.subjects
      .find({ groupId: new Types.ObjectId(groupId) }, { name: 1 })
      .lean()
      .exec();
    const subjectName = new Map(subjects.map((s) => [String(s._id), s.name]));
    const completions = await this.attachCompletions(hw, userId);
    return completions
      .filter((c) => !c.done)
      .map((c) => ({
        _id: String(c.homework._id),
        title: c.homework.title,
        deadline: c.homework.deadline,
        subjectId: String(c.homework.subjectId),
        subjectName: subjectName.get(String(c.homework.subjectId)) ?? '',
        points: c.homework.points,
        teamSize: c.homework.teamSize ?? 1,
        done: c.done,
      }));
  }

  async listAllForUser(groupId: string, userId: string): Promise<Array<Record<string, unknown>>> {
    const hw = await this.homework
      .find({ groupId: new Types.ObjectId(groupId), teamSize: { $ne: 0 } }, LIST_FIELDS)
      .sort({ deadline: 1 })
      .lean()
      .exec();
    const subjects = await this.subjects
      .find({ groupId: new Types.ObjectId(groupId) }, { name: 1 })
      .lean()
      .exec();
    const subjectName = new Map(subjects.map((s) => [String(s._id), s.name]));
    const completions = await this.attachCompletions(hw, userId);
    return completions.map((c) => ({
      _id: String(c.homework._id),
      title: c.homework.title,
      deadline: c.homework.deadline,
      subjectId: String(c.homework.subjectId),
      subjectName: subjectName.get(String(c.homework.subjectId)) ?? '',
      points: c.homework.points,
      teamSize: c.homework.teamSize ?? 1,
      done: c.done,
    }));
  }

  async findOneForUser(id: string, user: RequestUser): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Homework not found');
    const hw = await this.homework.findById(id).exec();
    if (!hw) throw new NotFoundException('Homework not found');
    await this.access.assertAccess(user, String(hw.groupId));
    const subject = await this.subjects.findById(hw.subjectId).lean().exec();
    const completion = await this.completions
      .findOne({ homeworkId: hw._id, userId: new Types.ObjectId(user.userId) })
      .lean()
      .exec();
    const m = user.memberships.find((x) => x.groupId === String(hw.groupId));
    // Homework is editable by any member of the group (community-managed list).
    // Permission to *complete* it (the "Позначити виконаним" button) is what the
    // `isTeacher` flag below controls — teachers don't have homework themselves.
    const canManage = !!m;
    // Teachers don't complete homework — this also covers Campus-only teachers
    // who are linked to the subject but may not have a group membership yet.
    const isTeacher =
      m?.role === Role.Teacher ||
      !!subject?.teachers?.some(
        (t) => t.teacherUserId && String(t.teacherUserId) === user.userId,
      );
    return {
      _id: String(hw._id),
      title: hw.title,
      description: hw.description,
      deadline: hw.deadline,
      points: hw.points,
      teamSize: hw.teamSize,
      subjectId: String(hw.subjectId),
      subjectName: subject?.name,
      attachments: hw.attachments ?? [],
      done: !!completion?.done,
      canManage,
      isTeacher,
    };
  }

  async markCompletion(user: RequestUser, homeworkId: string, done: boolean): Promise<void> {
    if (!Types.ObjectId.isValid(homeworkId)) throw new NotFoundException('Homework not found');
    const hw = await this.homework.findById(homeworkId, { groupId: 1 }).lean().exec();
    if (!hw) throw new NotFoundException('Homework not found');
    this.assertCanManage(user, String(hw.groupId));
    await this.completions.updateOne(
      { homeworkId: hw._id, userId: new Types.ObjectId(user.userId) },
      { $set: { done, doneAt: done ? new Date() : undefined } },
      { upsert: true },
    );
  }

  private async attachCompletions(
    list: HomeworkListRow[],
    userId: string,
  ): Promise<HomeworkWithDone[]> {
    if (list.length === 0) return [];
    const doneRows = await this.completions
      .find({
        homeworkId: { $in: list.map((h) => h._id) },
        userId: new Types.ObjectId(userId),
      })
      .lean()
      .exec();
    const doneMap = new Map(doneRows.map((r) => [String(r.homeworkId), r]));
    return list.map((h) => {
      const row = doneMap.get(String(h._id));
      return { homework: h, done: !!row?.done, doneAt: row?.doneAt };
    });
  }

  /**
   * Homework is community-managed: anyone in the group can add / edit / delete
   * any entry. The bar is just "be a member of this group". We keep this method
   * (rather than removing the gate) so a non-member curl-ing the API still gets
   * a clean 403.
   */
  private assertCanManage(user: RequestUser, groupId: string): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    if (!m) {
      throw new ForbiddenException('Тільки учасники групи можуть керувати ДЗ.');
    }
  }
}
