import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'queue_swap_requests' })
export class QueueSwapRequest {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Queue', required: true, index: true })
  queueId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) fromUserId!: Types.ObjectId;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) toUserId!: Types.ObjectId;

  @Prop({ required: true }) fromSlotIndex!: number;
  @Prop({ required: true }) toSlotIndex!: number;

  @Prop({
    type: String,
    enum: ['pending', 'accepted', 'declined', 'expired', 'cancelled'],
    default: 'pending',
  })
  status!: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
}

export type QueueSwapRequestDocument = HydratedDocument<QueueSwapRequest>;
export const QueueSwapRequestSchema = SchemaFactory.createForClass(QueueSwapRequest);
// Decided requests are dead weight after a while; pending ones never expire
// here. 30 days still covers requestSwap's 1-hour "recent request" dedupe.
QueueSwapRequestSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    partialFilterExpression: { status: { $in: ['accepted', 'declined', 'expired', 'cancelled'] } },
  },
);
// DB-enforced "one pending swap per user per queue" (requestSwap checks it too,
// but check-then-create races). The migration script dedupes existing pending
// duplicates first, otherwise the index build fails on startup.
QueueSwapRequestSchema.index(
  { queueId: 1, fromUserId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
