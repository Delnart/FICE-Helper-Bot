import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Homework, HomeworkSchema } from './homework.schema';
import { HomeworkCompletion, HomeworkCompletionSchema } from './homework-completion.schema';
import { HomeworkService } from './homework.service';
import { HomeworkController } from './homework.controller';
import { SubjectsModule } from '../subjects/subjects.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Homework.name, schema: HomeworkSchema },
      { name: HomeworkCompletion.name, schema: HomeworkCompletionSchema },
    ]),
    SubjectsModule,
  ],
  providers: [HomeworkService],
  controllers: [HomeworkController],
  exports: [HomeworkService, MongooseModule],
})
export class HomeworkModule {}
