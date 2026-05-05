import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { HomeworkService } from './homework.service';
import {
  CreateHomeworkDto,
  MarkCompletionDto,
  UpdateHomeworkDto,
} from './dto/homework.dto';
import { ActiveGroupId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

@Controller('homework')
export class HomeworkController {
  constructor(private readonly hw: HomeworkService) {}

  @Get('my/pending')
  myPending(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.hw.listForUserMainScreen(activeGroupId, user.userId);
  }

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('subjectId') subjectId?: string,
  ) {
    if (subjectId) {
      return this.hw.listBySubject(subjectId, user.userId);
    }
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.hw.listAllForUser(activeGroupId, user.userId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateHomeworkDto) {
    return this.hw.create(user, dto);
  }

  @Get(':id')
  one(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.hw.findOneForUser(id, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateHomeworkDto) {
    return this.hw.update(user, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.hw.remove(user, id);
    return { ok: true };
  }

  @Patch(':id/completion')
  async markCompletion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: MarkCompletionDto,
  ) {
    await this.hw.markCompletion(user.userId, id, dto.done);
    return { ok: true };
  }
}
