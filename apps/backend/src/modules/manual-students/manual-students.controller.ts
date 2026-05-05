import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { ManualStudentsService } from './manual-students.service';
import { ActiveGroupId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

class WriteManualStudentDto {
  @IsString() @MinLength(1) fullName!: string;
}

@Controller('manual-students')
export class ManualStudentsController {
  constructor(private readonly service: ManualStudentsService) {}

  @Get()
  async list(@ActiveGroupId() groupId: string | undefined) {
    if (!groupId) throw new BadRequestException('No active group');
    const docs = await this.service.listForGroup(groupId);
    return docs.map((d) => ({ _id: String(d._id), fullName: d.fullName }));
  }

  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() groupId: string | undefined,
    @Body() dto: WriteManualStudentDto,
  ) {
    if (!groupId) throw new BadRequestException('No active group');
    const doc = await this.service.create(user, groupId, dto.fullName);
    return { _id: String(doc._id), fullName: doc.fullName };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() groupId: string | undefined,
    @Param('id') id: string,
    @Body() dto: WriteManualStudentDto,
  ) {
    if (!groupId) throw new BadRequestException('No active group');
    const doc = await this.service.update(user, groupId, id, dto.fullName);
    return { _id: String(doc._id), fullName: doc.fullName };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() groupId: string | undefined,
    @Param('id') id: string,
  ) {
    if (!groupId) throw new BadRequestException('No active group');
    await this.service.remove(user, groupId, id);
    return { ok: true };
  }
}
