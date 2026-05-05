import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Announcement, AnnouncementSchema } from './announcement.schema';
import { NotificationPrefs, NotificationPrefsSchema } from './notification-prefs.schema';
import { LessonReminderMark, LessonReminderMarkSchema } from './lesson-reminder-mark.schema';
import { NotificationsService } from './notifications.service';
import { SchedulerService } from './scheduler.service';
import { NotificationsController } from './notifications.controller';
import { BotModule } from '../bot/bot.module';
import { GroupsModule } from '../groups/groups.module';
import { UsersModule } from '../users/users.module';
import { ScheduleApiModule } from '../schedule/schedule.module';
import { QueuesModule } from '../queues/queues.module';
import { HomeworkModule } from '../homework/homework.module';
import { CampusModule } from '../campus/campus.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Announcement.name, schema: AnnouncementSchema },
      { name: NotificationPrefs.name, schema: NotificationPrefsSchema },
      { name: LessonReminderMark.name, schema: LessonReminderMarkSchema },
    ]),
    BotModule,
    GroupsModule,
    UsersModule,
    ScheduleApiModule,
    QueuesModule,
    HomeworkModule,
    CampusModule,
  ],
  providers: [NotificationsService, SchedulerService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
