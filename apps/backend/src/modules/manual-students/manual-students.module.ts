import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ManualStudent, ManualStudentSchema } from './manual-student.schema';
import { ManualStudentsService } from './manual-students.service';
import { ManualStudentsController } from './manual-students.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ManualStudent.name, schema: ManualStudentSchema },
    ]),
  ],
  providers: [ManualStudentsService],
  controllers: [ManualStudentsController],
  exports: [ManualStudentsService, MongooseModule],
})
export class ManualStudentsModule {}
