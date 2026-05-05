import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleLesson, ScheduleLessonSchema } from './schedule.schema';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';
import { CampusModule } from '../campus/campus.module';
import { GroupsModule } from '../groups/groups.module';
import { Subject, SubjectSchema } from '../subjects/subject.schema';
import { User, UserSchema } from '../users/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScheduleLesson.name, schema: ScheduleLessonSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CampusModule,
    GroupsModule,
  ],
  providers: [ScheduleService],
  controllers: [ScheduleController],
  exports: [ScheduleService, MongooseModule],
})
export class ScheduleApiModule {}
