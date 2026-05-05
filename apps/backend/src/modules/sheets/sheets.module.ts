import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SheetsService } from './sheets.service';
import { User, UserSchema } from '../users/user.schema';
import { AcademicGroup, AcademicGroupSchema } from '../groups/group.schema';
import { Subject, SubjectSchema } from '../subjects/subject.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AcademicGroup.name, schema: AcademicGroupSchema },
      { name: Subject.name, schema: SubjectSchema },
    ]),
  ],
  providers: [SheetsService],
  exports: [SheetsService],
})
export class SheetsModule {}
