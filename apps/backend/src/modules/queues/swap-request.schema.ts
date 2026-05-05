import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'queue_swap_requests' })
export class QueueSwapRequest {
  @Prop({ type: Types.ObjectId, ref: 'Queue', required: true, index: true })
  queueId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) fromUserId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) toUserId!: Types.ObjectId;

  @Prop({ required: true }) fromSlotIndex!: number;
  @Prop({ required: true }) toSlotIndex!: number;

  @Prop({ type: String, enum: ['pending', 'accepted', 'declined', 'expired'], default: 'pending' })
  status!: 'pending' | 'accepted' | 'declined' | 'expired';
}

export type QueueSwapRequestDocument = HydratedDocument<QueueSwapRequest>;
export const QueueSwapRequestSchema = SchemaFactory.createForClass(QueueSwapRequest);
