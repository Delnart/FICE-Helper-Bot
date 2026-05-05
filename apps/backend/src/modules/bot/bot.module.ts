import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BotService } from './bot.service';
import { SupportTicket, SupportTicketSchema } from './support-ticket.schema';
import { GroupsModule } from '../groups/groups.module';
import { UsersModule } from '../users/users.module';
import { CampusModule } from '../campus/campus.module';
import { SheetsModule } from '../sheets/sheets.module';
import { ScheduleApiModule } from '../schedule/schedule.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SupportTicket.name, schema: SupportTicketSchema }]),
    GroupsModule,
    forwardRef(() => UsersModule),
    CampusModule,
    SheetsModule,
    ScheduleApiModule,
  ],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
