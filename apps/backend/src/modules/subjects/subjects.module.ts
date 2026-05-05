import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Subject, SubjectSchema } from './subject.schema';
import { AttendanceSession, AttendanceSessionSchema } from './attendance.schema';
import { AcademicGroup, AcademicGroupSchema } from '../groups/group.schema';
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
