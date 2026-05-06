import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { ActiveGroupId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get('my')
  my(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('week') weekType?: string,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    const week = weekType === '1' || weekType === '2' ? Number(weekType) : undefined;
    return this.schedule.getForUser(activeGroupId, user.userId, week as 1 | 2 | undefined);
  }

  @Get('now')
  now(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.schedule.nowFor(activeGroupId, user.userId);
  }

  @Get('group-week')
  groupWeek(
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('week') weekType?: string,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    const week = weekType === '1' || weekType === '2' ? Number(weekType) : undefined;
    return this.schedule.getForGroup(activeGroupId, week as 1 | 2 | undefined);
  }

  /**
   * Lecturer schedule (live from Campus by user.campusLecturerId).
   * Used by the teacher home page and the /schedule view when the user is a teacher.
   */
  @Get('lecturer/week')
  lecturerWeek(
    @CurrentUser() user: RequestUser,
    @Query('week') weekType?: string,
  ) {
    const week = weekType === '1' || weekType === '2' ? Number(weekType) : undefined;
    return this.schedule.lecturerWeek(user.userId, week as 1 | 2 | undefined);
  }

  @Get('lecturer/now')
  lecturerNow(@CurrentUser() user: RequestUser) {
    return this.schedule.lecturerNow(user.userId);
  }

  /**
   * Exam-schedule (сесія) for the active group. Anyone in the group sees it.
   */
  @Get('sessions')
  sessions(@ActiveGroupId() activeGroupId: string | undefined) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.schedule.sessionsForGroup(activeGroupId);
  }

  /** Exam-schedule for teachers (across all groups they teach in). */
  @Get('lecturer/sessions')
  lecturerSessions(@CurrentUser() user: RequestUser) {
    return this.schedule.sessionsForLecturer(user.userId);
  }

  @Post('sync')
  sync(
    @CurrentUser() user: RequestUser,
    @Body('groupId') groupId: string,
    @ActiveGroupId() activeGroupId: string | undefined,
  ) {
    const target = groupId ?? activeGroupId;
    if (!target) throw new BadRequestException('No group');
    return this.schedule.syncFromCampus(user, target).then((count) => ({ count }));
  }

  @Post('electives/:lessonId/join')
  join(@CurrentUser() user: RequestUser, @Param('lessonId') lessonId: string) {
    return this.schedule.chooseElective(user.userId, lessonId, true).then(() => ({ ok: true }));
  }

  @Post('electives/:lessonId/leave')
  leave(@CurrentUser() user: RequestUser, @Param('lessonId') lessonId: string) {
    return this.schedule.chooseElective(user.userId, lessonId, false).then(() => ({ ok: true }));
  }
}
