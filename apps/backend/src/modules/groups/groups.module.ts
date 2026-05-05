import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AcademicGroup, AcademicGroupSchema } from './group.schema';
import { User, UserSchema } from '../users/user.schema';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { SheetsModule } from '../sheets/sheets.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AcademicGroup.name, schema: AcademicGroupSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SheetsModule,
  ],
  providers: [GroupsService],
  controllers: [GroupsController],
  exports: [GroupsService, MongooseModule],
})
export class GroupsModule {}
