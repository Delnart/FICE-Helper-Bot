import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateAnnouncementDto, UpdatePrefsDto } from './dto/announcement.dto';
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
  prefs(@CurrentUser() user: RequestUser) {
    return this.svc.getOrCreatePrefs(user.userId);
  }

  @Patch('prefs')
  updatePrefs(@CurrentUser() user: RequestUser, @Body() dto: UpdatePrefsDto) {
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
