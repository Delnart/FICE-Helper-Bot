import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Queue, QueueSchema } from './queue.schema';
import { QueueSwapRequest, QueueSwapRequestSchema } from './swap-request.schema';
import { QueuesService } from './queues.service';
import { QueuesController } from './queues.controller';
import { SubjectsModule } from '../subjects/subjects.module';
import { UsersModule } from '../users/users.module';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Queue.name, schema: QueueSchema },
      { name: QueueSwapRequest.name, schema: QueueSwapRequestSchema },
    ]),
    SubjectsModule,
    UsersModule,
    BotModule,
  ],
  providers: [QueuesService],
  controllers: [QueuesController],
  exports: [QueuesService, MongooseModule],
})
export class QueuesModule {}
