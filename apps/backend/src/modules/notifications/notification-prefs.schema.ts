import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'notification_prefs' })
export class NotificationPrefs {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ default: true }) dmQueueOpen!: boolean;
  @Prop({ default: true }) dmNextInQueue!: boolean;
  @Prop({ default: true }) dmDeadlineTomorrow!: boolean;
  @Prop({ default: true }) dmSwapRequests!: boolean;
}

export type NotificationPrefsDocument = HydratedDocument<NotificationPrefs>;
export const NotificationPrefsSchema = SchemaFactory.createForClass(NotificationPrefs);
