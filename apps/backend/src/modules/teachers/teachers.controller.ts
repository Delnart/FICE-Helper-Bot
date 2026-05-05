import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import { ApplyTeacherDto, DecideApplicationDto, GroupJoinRequestDto, IdentifyTeacherDto, InviteTeacherDto } from './dto/teacher.dto';
import { ActiveGroupId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

@Controller('teachers')
export class TeachersController {
  constructor(private readonly svc: TeachersService) {}

  // ── Group-level join requests ─────────────────────────────────────────────

  /** Teacher submits a request to join a group. */
  @Post('join-request')
  joinRequest(@CurrentUser() user: RequestUser, @Body() dto: GroupJoinRequestDto) {
    return this.svc.requestGroupAccess(user, dto);
  }

  /** The requesting teacher sees their own pending/decided requests. */
  @Get('join-request/mine')
  myJoinRequests(@CurrentUser() user: RequestUser) {
    return this.svc.myJoinRequests(user.userId);
  }

  /** Head/deputy lists pending join requests for their active group. */
  @Get('join-requests')
  listJoinRequests(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Query('groupId') groupIdQuery?: string,
  ) {
    const groupId = groupIdQuery ?? activeGroupId;
    if (!groupId) throw new BadRequestException('No active group');
    return this.svc.listGroupJoinRequests(user, groupId);
  }

  /** Returns groups the current teacher teaches in, with their subjects. */
  @Get('my-groups')
  myGroups(@CurrentUser() user: RequestUser) {
    return this.svc.getMyGroups(user.userId);
  }

  /**
   * Match the teacher's name against the Campus KPI lecturer list, store the
   * resulting `campusLecturerId`, and auto-link to any matching DB subjects.
   */
  @Post('identify')
  identify(@CurrentUser() user: RequestUser, @Body() dto: IdentifyTeacherDto) {
    return this.svc.identifyTeacher(user.userId, dto);
  }

  /** All subjects this teacher is linked to, with group context. */
  @Get('my-subjects')
  mySubjects(@CurrentUser() user: RequestUser) {
    return this.svc.getMySubjects(user.userId);
  }

  // ── Subject-level applications ─────────────────────────────────────────────

  @Post('apply')
  apply(@CurrentUser() user: RequestUser, @Body() dto: ApplyTeacherDto) {
    return this.svc.apply(user, dto);
  }

  @Post('invite')
  invite(@CurrentUser() user: RequestUser, @Body() dto: InviteTeacherDto) {
    return this.svc.invite(user, dto);
  }

  @Post('applications/:id/decide')
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: DecideApplicationDto,
  ) {
    return this.svc.decide(user, id, dto.action).then(() => ({ ok: true }));
  }

  @Get('applications')
  listApps(@Query('subjectId') subjectId: string) {
    return this.svc.listApplications(subjectId);
  }

}
