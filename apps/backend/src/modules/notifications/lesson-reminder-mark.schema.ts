import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'lesson_reminder_marks' })
export class LessonReminderMark {
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ScheduleLesson', required: true, index: true })
  lessonId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  reminderDate!: string;

  @Prop({ default: () => new Date() })
  sentAt!: Date;
}

export type LessonReminderMarkDocument = HydratedDocument<LessonReminderMark>;
export const LessonReminderMarkSchema = SchemaFactory.createForClass(LessonReminderMark);
LessonReminderMarkSchema.index({ groupId: 1, lessonId: 1, reminderDate: 1 }, { unique: true });
LessonReminderMarkSchema.index({ sentAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 45 });