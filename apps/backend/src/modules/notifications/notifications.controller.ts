import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateAnnouncementDto, UpdatePrefsDto } from './dto/announcement.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('prefs')
  prefs(@CurrentUser() user: RequestUser) {
    return this.svc.getOrCreatePrefs(user.userId);
  }

  @Patch('prefs')
  updatePrefs(@CurrentUser() user: RequestUser, @Body() dto: UpdatePrefsDto) {
    return this.svc.updatePrefs(user.userId, dto);
  }

  @Get('announcements')
  listAnnouncements(@Query('groupId') groupId: string) {
    return this.svc.listAnnouncements(groupId);
  }

  @Post('announcements')
  createAnnouncement(@CurrentUser() user: RequestUser, @Body() dto: CreateAnnouncementDto) {
    return this.svc.createAnnouncement(user.userId, dto);
  }
}
