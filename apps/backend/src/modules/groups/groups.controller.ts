import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { GroupsService } from './groups.service';
import { CurrentUser, ActiveGroupId } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@fice/shared';

class AssignDeputyDto {
  @IsString() targetUserId!: string;
}

class UpdateReminderDto {
  @IsOptional() @IsInt() @Min(0) @Max(60) lessonReminderMinutes?: number;
  @IsOptional() @IsBoolean() notificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() birthdayAnnouncementsEnabled?: boolean;
}

class UpdateCampusBindingDto {
  @IsString() campusGroupId!: string;
}

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get('mine')
  async mine(@CurrentUser() user: RequestUser) {
    return this.groups.listMyGroups(user.userId);
  }

  /** Public search — anyone logged in can browse groups to send a join request. */
  @Get('search')
  async search(@Query('q') q: string) {
    return this.groups.searchPublic(q ?? '');
  }

  @Get('current/settings')
  async currentSettings(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.groups.getSettingsForUser(user, activeGroupId);
  }

  @Patch('current/settings')
  async updateCurrentSettings(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Body() dto: UpdateReminderDto,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.groups.updateSettingsForUser(user, activeGroupId, dto);
  }

  @Patch('current/campus')
  async bindCampus(
    @CurrentUser() user: RequestUser,
    @ActiveGroupId() activeGroupId: string | undefined,
    @Body() dto: UpdateCampusBindingDto,
  ) {
    if (!activeGroupId) throw new BadRequestException('No active group');
    return this.groups.setCampusGroupId(user, activeGroupId, dto.campusGroupId);
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return this.groups.findById(id);
  }

  @Roles(Role.GroupHead)
  @Post(':id/deputies')
  async assignDeputy(
    @Param('id') id: string,
    @Body() dto: AssignDeputyDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.groups.assignDeputy(id, user.userId, dto.targetUserId);
    return { ok: true };
  }

  @Roles(Role.GroupHead)
  @Delete(':id/deputies/:userId')
  async removeDeputy(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    await this.groups.removeDeputy(id, user.userId, targetUserId);
    return { ok: true };
  }

  @Roles(Role.DeputyHead)
  @Patch(':id/settings')
  async updateSettings(@Param('id') id: string, @Body() dto: UpdateReminderDto) {
    return this.groups.updateReminderSettings(id, dto);
  }
}
