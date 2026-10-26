import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'notification_prefs' })
export class NotificationPrefs {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ default: true }) dmQueueOpen!: boolean;
  @Prop({ default: true }) dmNextInQueue!: boolean;
  @Prop({ default: true }) dmDeadlineTomorrow!: boolean;
  @Prop({ default: true }) dmSwapRequests!: boolean;
  // Opt-in (unlike the above): only `true` in the DB sends, a missing field never does.
  @Prop({ default: false }) dmMorningDigest!: boolean;
  @Prop({ default: false }) dmLessonReminder!: boolean;
}

export type NotificationPrefsDocument = HydratedDocument<NotificationPrefs>;
export const NotificationPrefsSchema = SchemaFactory.createForClass(NotificationPrefs);
