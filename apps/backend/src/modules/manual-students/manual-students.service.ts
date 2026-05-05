import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { ManualStudent, ManualStudentDocument } from './manual-student.schema';
import { RequestUser } from '../../common/types/request-user';

@Injectable()
export class ManualStudentsService {
  constructor(
    @InjectModel(ManualStudent.name)
    private readonly model: Model<ManualStudentDocument>,
  ) {}

  async listForGroup(groupId: string): Promise<ManualStudentDocument[]> {
    if (!Types.ObjectId.isValid(groupId)) return [];
    return this.model.find({ groupId: new Types.ObjectId(groupId) }).exec();
  }

  async create(user: RequestUser, groupId: string, fullName: string): Promise<ManualStudentDocument> {
    this.assertCanManage(user, groupId);
    const trimmed = fullName.trim();
    if (!trimmed) throw new NotFoundException('fullName required');
    return this.model.create({
      groupId: new Types.ObjectId(groupId),
      fullName: trimmed,
      createdBy: new Types.ObjectId(user.userId),
    });
  }

  async update(
    user: RequestUser,
    groupId: string,
    id: string,
    fullName: string,
  ): Promise<ManualStudentDocument> {
    this.assertCanManage(user, groupId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
    const doc = await this.model.findById(id).exec();
    if (!doc || String(doc.groupId) !== groupId) {
      throw new NotFoundException('Not found');
    }
    doc.fullName = fullName.trim();
    await doc.save();
    return doc;
  }

  async remove(user: RequestUser, groupId: string, id: string): Promise<void> {
    this.assertCanManage(user, groupId);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
    const res = await this.model
      .deleteOne({ _id: new Types.ObjectId(id), groupId: new Types.ObjectId(groupId) })
      .exec();
    if (!res.deletedCount) throw new NotFoundException('Not found');
  }

  private assertCanManage(user: RequestUser, groupId: string): void {
    const m = user.memberships.find((x) => x.groupId === groupId);
    const level = m ? ROLE_LEVEL[m.role] : 0;
    if (level < ROLE_LEVEL[Role.DeputyHead]) {
      throw new ForbiddenException('Лише староста або заступник можуть редагувати список студентів.');
    }
  }
}
