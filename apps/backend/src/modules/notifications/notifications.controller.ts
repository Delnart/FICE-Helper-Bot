import { Body, Controller, ForbiddenException, Get, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateAnnouncementDto, PrefsQueryDto, UpdatePrefsDto } from './dto/announcement.dto';
import { Role } from '@fice/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';
import { GroupAccessService } from '../../common/access/group-access';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly svc: NotificationsService,
    private readonly access: GroupAccessService,
  ) {}

  @Get('prefs')
  prefs(@CurrentUser() user: RequestUser, @Query() q: PrefsQueryDto) {
    return this.svc.getPrefs(user.userId, memberGroup(user, q.groupId));
  }

  @Patch('prefs')
  updatePrefs(@CurrentUser() user: RequestUser, @Body() dto: UpdatePrefsDto) {
    memberGroup(user, dto.groupId);
    return this.svc.updatePrefs(user.userId, dto);
  }

  @Get('announcements')
  async listAnnouncements(@CurrentUser() user: RequestUser, @Query('groupId') groupId: string) {
    return this.svc.listAnnouncements(await this.access.assertAccess(user, groupId));
  }

  @Post('announcements')
  async createAnnouncement(@CurrentUser() user: RequestUser, @Body() dto: CreateAnnouncementDto) {
    // Can broadcast into the group's Telegram chat — head/deputy only.
    await this.access.assertAccess(user, dto.groupId, Role.DeputyHead);
    return this.svc.createAnnouncement(user.userId, dto);
  }
}

/** Per-group prefs only for the user's own memberships — DMs go to members, never to a taught-only group. */
function memberGroup(user: RequestUser, groupId?: string): string | undefined {
  if (groupId && !user.memberships.some((m) => m.groupId === groupId)) {
    throw new ForbiddenException('Немає доступу до цієї групи');
  }
  return groupId;
}
