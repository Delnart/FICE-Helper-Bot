import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AttendanceStatus, Role, ROLE_LEVEL } from '@fice/shared';
import { AttendanceService } from './attendance.service';
import { UpsertAttendanceDto } from './dto/attendance.dto';
import { ActiveGroupId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';
import { SubjectsService } from '../subjects/subjects.service';

/** Throw 403 unless the user can manage the journal (head/deputy/teacher/admin). */
function assertJournalAccess(user: RequestUser, groupId: string): void {
  const m = user.memberships.find((x) => x.groupId === groupId);
  const level = m ? ROLE_LEVEL[m.role] : 0;
  if (level < ROLE_LEVEL[Role.Teacher]) {
    throw new ForbiddenException(
      'Журнал доступний лише старості, заступнику чи викладачам.',
    );
  }
}

class UpsertEntryDto {
  @IsString() scheduleLessonId!: string;
  @IsString() date!: string;
  @IsString() userId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsOptional() @IsString() note?: string;
}

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly subjects: SubjectsService,
  ) {}

  @Get('my')
  my(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('weekStart') weekStart?: string,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.attendance.getUserWeek(activeGroupId, user.userId, weekStart ? new Date(weekStart) : undefined);
  }

  @Get('my/stats')
  myStats(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.attendance.statsForUser(activeGroupId, user.userId);
  }

  @Get('week')
  async week(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('weekStart') weekStart: string,
    @Query('groupId') groupIdQuery?: string,
    @Query('subjectIds') subjectIdsQuery?: string,
  ) {
    const groupId = await this.resolveJournalGroup(user, activeGroupId, groupIdQuery, subjectIdsQuery);
    return this.attendance.getWeek(groupId, new Date(weekStart));
  }

  @Get('week-grid')
  async weekGrid(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('weekStart') weekStart?: string,
    @Query('groupId') groupIdQuery?: string,
    @Query('subjectIds') subjectIdsQuery?: string,
  ) {
    const groupId = await this.resolveJournalGroup(user, activeGroupId, groupIdQuery, subjectIdsQuery);
    return this.attendance.weekGrid(groupId, weekStart ? new Date(weekStart) : undefined);
  }

  @Patch('entry')
  async upsertEntry(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Body() dto: UpsertEntryDto,
    @Query('groupId') groupIdQuery?: string,
    @Query('subjectIds') subjectIdsQuery?: string,
  ) {
    const activeGroupId2 = await this.resolveJournalGroup(user, activeGroupId, groupIdQuery, subjectIdsQuery);
    await this.attendance.upsertEntry(user, activeGroupId2, {
      scheduleLessonId: dto.scheduleLessonId,
      date: new Date(dto.date),
      userId: dto.userId,
      status: dto.status,
      note: dto.note,
    }, {
      allowSubjectTeacherAccess: !!subjectIdsQuery,
    });
    return { ok: true };
  }

  @Get('lesson')
  lesson(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('lessonId') lessonId: string,
    @Query('date') date: string,
    @Query('groupId') groupIdQuery?: string,
    @Query('subjectIds') subjectIdsQuery?: string,
  ) {
    const groupIdPromise = this.resolveJournalGroup(user, activeGroupId, groupIdQuery, subjectIdsQuery);
    if (!lessonId || !date) throw new BadRequestException('lessonId and date are required');
    return groupIdPromise.then((groupId) => this.attendance.getLessonRecord(groupId, lessonId, new Date(date)));
  }

  @Post()
  upsert(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Body() dto: UpsertAttendanceDto,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.attendance.upsert(user, activeGroupId, dto);
  }

  @Get('stats/:userId')
  stats(
    @ActiveGroupId() activeGroupId: string | undefined,
    @Param('userId') userId: string,
    @Query('groupId') groupIdQuery?: string,
  ) {
    const groupId = groupIdQuery ?? activeGroupId;
    if (!groupId) throw new BadRequestException('No active group');
    return this.attendance.statsForUser(groupId, userId);
  }

  private async resolveJournalGroup(
    user: RequestUser,
    activeGroupId: string | undefined,
    groupIdQuery: string | undefined,
    subjectIdsQuery?: string,
  ): Promise<string> {
    const subjectIds = subjectIdsQuery
      ? subjectIdsQuery.split(',').map((id) => id.trim()).filter(Boolean)
      : [];
    if (subjectIds.length > 0) {
      const subject = await this.subjects.findById(subjectIds[0]);
      if (!subject) throw new BadRequestException('Subject not found');
      if (!this.canAccessSubjectJournal(user, subject)) {
        throw new ForbiddenException('Журнал доступний лише старості, заступнику чи викладачам.');
      }
      return String(subject.groupId);
    }

    const groupId = groupIdQuery ?? activeGroupId;
    if (!groupId) throw new BadRequestException('No active group');
    assertJournalAccess(user, groupId);
    return groupId;
  }

  private canAccessSubjectJournal(
    user: RequestUser,
    subject: { groupId: unknown; teachers?: Array<{ teacherUserId?: unknown }> },
  ): boolean {
    const groupId = String(subject.groupId);
    const m = user.memberships.find((x) => x.groupId === groupId);
    if (m && ROLE_LEVEL[m.role] >= ROLE_LEVEL[Role.Teacher]) return true;
    return (subject.teachers ?? []).some(
      (t) => t.teacherUserId && String(t.teacherUserId) === user.userId,
    );
  }
}
