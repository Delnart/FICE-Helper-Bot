import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { AcademicGroup, AcademicGroupSchema } from '../groups/group.schema';
import { Subject, SubjectSchema } from '../subjects/subject.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { BotModule } from '../bot/bot.module';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AcademicGroup.name, schema: AcademicGroupSchema },
      { name: Subject.name, schema: SubjectSchema },
    ]),
    forwardRef(() => BotModule),
    SheetsModule,
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
