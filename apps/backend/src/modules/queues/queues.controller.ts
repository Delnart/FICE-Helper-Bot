import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { QueuesService } from './queues.service';
import {
  AdminEnrollDto,
  CreateQueueDto,
  EnrollDto,
  RequestSwapDto,
  UpdateEntryDto,
  UpdateQueueDto,
} from './dto/queue.dto';
import { ActiveGroupId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

@Controller('queues')
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  @Get()
  list(
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('groupId') groupIdQuery?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    const groupId = groupIdQuery ?? activeGroupId;
    if (!groupId) throw new BadRequestException('No active group');
    return this.queues.list(groupId, subjectId);
  }

  @Get('open')
  listOpen(@ActiveGroupId() activeGroupId: string | undefined) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.queues.listOpen(activeGroupId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateQueueDto) {
    return this.queues.create(user, dto);
  }

  @Post('swaps/:swapId/respond')
  respondSwap(
    @CurrentUser() user: RequestUser,
    @Param('swapId') swapId: string,
    @Body('accept') accept: boolean,
  ) {
    return this.queues.respondSwap(user, swapId, accept);
  }

  @Get('by-subject/:subjectId')
  bySubject(@CurrentUser() user: RequestUser, @Param('subjectId') subjectId: string) {
    return this.queues.findOrCreateForSubject(user, subjectId);
  }

  @Get(':id')
  one(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.queues.findByIdForUser(user, id);
  }

  @Get(':id/swaps/incoming')
  incomingSwaps(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.queues.listIncomingSwaps(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateQueueDto) {
    return this.queues.update(user, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.queues.remove(user, id);
    return { ok: true };
  }

  @Post(':id/enroll')
  enroll(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: EnrollDto) {
    return this.queues.enroll(user, id, dto);
  }

  @Post(':id/admin-enroll')
  adminEnroll(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AdminEnrollDto,
  ) {
    return this.queues.adminEnroll(user, id, dto);
  }

  @Delete(':id/entries/:slot')
  leave(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('slot', ParseIntPipe) slot: number,
  ) {
    return this.queues.leave(user, id, slot);
  }

  @Patch(':id/entries/:slot')
  updateEntry(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('slot', ParseIntPipe) slot: number,
    @Body() dto: UpdateEntryDto,
  ) {
    return this.queues.updateEntry(user, id, slot, dto);
  }

  @Post(':id/entries/:slot/swap')
  requestSwap(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('slot', ParseIntPipe) slot: number,
    @Body() dto: RequestSwapDto,
  ) {
    return this.queues.requestSwap(user, id, slot, dto);
  }
}
