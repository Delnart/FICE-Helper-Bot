import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeacherApplication, TeacherApplicationSchema } from './teacher-application.schema';
import { Homework, HomeworkSchema } from '../homework/homework.schema';
import { ManualStudent, ManualStudentSchema } from '../manual-students/manual-student.schema';
import { TeachersService } from './teachers.service';
import { TeachersController } from './teachers.controller';
import { SubjectsModule } from '../subjects/subjects.module';
import { UsersModule } from '../users/users.module';
import { GroupsModule } from '../groups/groups.module';
import { BotModule } from '../bot/bot.module';
import { CampusModule } from '../campus/campus.module';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherApplication.name, schema: TeacherApplicationSchema },
      { name: Homework.name, schema: HomeworkSchema },
      { name: ManualStudent.name, schema: ManualStudentSchema },
    ]),
    SubjectsModule,
    UsersModule,
    GroupsModule,
    CampusModule,
    SheetsModule,
    forwardRef(() => BotModule),
  ],
  providers: [TeachersService],
  controllers: [TeachersController],
  exports: [TeachersService],
})
export class TeachersModule {}
