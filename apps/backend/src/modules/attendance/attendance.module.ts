import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceRecord, AttendanceRecordSchema } from './attendance.schema';
import { ScheduleLesson, ScheduleLessonSchema } from '../schedule/schedule.schema';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { UsersModule } from '../users/users.module';
import { CampusModule } from '../campus/campus.module';
import { ManualStudentsModule } from '../manual-students/manual-students.module';
import { SubjectsModule } from '../subjects/subjects.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AttendanceRecord.name, schema: AttendanceRecordSchema },
      { name: ScheduleLesson.name, schema: ScheduleLessonSchema },
    ]),
    UsersModule,
    CampusModule,
    ManualStudentsModule,
    SubjectsModule,
  ],
  providers: [AttendanceService],
  controllers: [AttendanceController],
  exports: [AttendanceService, MongooseModule],
})
export class AttendanceModule {}
