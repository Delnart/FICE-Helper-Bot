import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Subject, SubjectSchema } from './subject.schema';
import { AttendanceSession, AttendanceSessionSchema } from './attendance.schema';
import { AcademicGroup, AcademicGroupSchema } from '../groups/group.schema';
import { Homework, HomeworkSchema } from '../homework/homework.schema';
import { HomeworkCompletion, HomeworkCompletionSchema } from '../homework/homework-completion.schema';
import { Queue, QueueSchema } from '../queues/queue.schema';
import { QueueSwapRequest, QueueSwapRequestSchema } from '../queues/swap-request.schema';
import { TeacherApplication, TeacherApplicationSchema } from '../teachers/teacher-application.schema';
import { ScheduleLesson, ScheduleLessonSchema } from '../schedule/schedule.schema';
import { SubjectsService } from './subjects.service';
import { SubjectsController } from './subjects.controller';
import { SheetsModule } from '../sheets/sheets.module';
import { UsersModule } from '../users/users.module';
import { CampusModule } from '../campus/campus.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subject.name, schema: SubjectSchema },
      { name: AttendanceSession.name, schema: AttendanceSessionSchema },
      { name: AcademicGroup.name, schema: AcademicGroupSchema },
      // What remove() deletes or unlinks along with the subject.
      { name: Homework.name, schema: HomeworkSchema },
      { name: HomeworkCompletion.name, schema: HomeworkCompletionSchema },
      { name: Queue.name, schema: QueueSchema },
      { name: QueueSwapRequest.name, schema: QueueSwapRequestSchema },
      { name: TeacherApplication.name, schema: TeacherApplicationSchema },
      { name: ScheduleLesson.name, schema: ScheduleLessonSchema },
    ]),
    SheetsModule,
    UsersModule,
    CampusModule,
  ],
  providers: [SubjectsService],
  controllers: [SubjectsController],
  exports: [SubjectsService, MongooseModule],
})
export class SubjectsModule {}
