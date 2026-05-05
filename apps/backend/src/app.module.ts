import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { appConfig } from './config/app.config';
import { validateEnv } from './config/env.validation';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { GroupsModule } from './modules/groups/groups.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { QueuesModule } from './modules/queues/queues.module';
import { HomeworkModule } from './modules/homework/homework.module';
import { ScheduleApiModule } from './modules/schedule/schedule.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { TeachersModule } from './modules/teachers/teachers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BotModule } from './modules/bot/bot.module';
import { CampusModule } from './modules/campus/campus.module';
import { SheetsModule } from './modules/sheets/sheets.module';
import { ManualStudentsModule } from './modules/manual-students/manual-students.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.getOrThrow<string>('MONGO_URI'),
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => [
        {
          ttl: parseInt(cfg.get('RATE_LIMIT_TTL') ?? '60', 10) * 1000,
          limit: parseInt(cfg.get('RATE_LIMIT_MAX') ?? '120', 10),
        },
      ],
    }),
    ScheduleModule.forRoot(),

    AuthModule,
    UsersModule,
    GroupsModule,
    SubjectsModule,
    QueuesModule,
    HomeworkModule,
    ScheduleApiModule,
    AttendanceModule,
    TeachersModule,
    NotificationsModule,
    CampusModule,
    SheetsModule,
    BotModule,
    ManualStudentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
