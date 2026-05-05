import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'academic_groups' })
export class AcademicGroup {
  @Prop({ required: true, index: true })
  academicName!: string;

  @Prop({ required: true, unique: true, index: true })
  telegramChatId!: number;

  /** Optional topic/thread inside the group chat to direct bot replies to. */
  @Prop() messageThreadId?: number;

  @Prop() campusGroupId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  headUserId?: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  deputyUserIds!: Types.ObjectId[];

  @Prop({ default: true }) notificationsEnabled!: boolean;
  @Prop({ default: 10 }) lessonReminderMinutes!: number;
  @Prop({ default: true }) birthdayAnnouncementsEnabled!: boolean;

  /**
   * 'active' — bot is in the chat and the group is usable.
   * 'inactive' — bot was removed / chat deleted; group is frozen and members
   * lose access to /users/me responses for this group until the bot is re-added.
   */
  @Prop({ type: String, enum: ['active', 'inactive'], default: 'active', index: true })
  status!: 'active' | 'inactive';
}

export type AcademicGroupDocument = HydratedDocument<AcademicGroup>;
export const AcademicGroupSchema = SchemaFactory.createForClass(AcademicGroup);
