import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A "placeholder" student in a group's journal — added manually by the head
 * for someone who doesn't (yet) have a Telegram account in the bot.
 * If a real User with the same fullName joins later, the journal will surface
 * their @username next to the manual entry as a hint to the head.
 */
@Schema({ timestamps: true, collection: 'manual_students' })
export class ManualStudent {
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true, trim: true }) fullName!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type ManualStudentDocument = HydratedDocument<ManualStudent>;
export const ManualStudentSchema = SchemaFactory.createForClass(ManualStudent);
ManualStudentSchema.index({ groupId: 1, fullName: 1 });
