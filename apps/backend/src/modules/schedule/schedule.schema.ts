import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'schedule_lessons' })
export class ScheduleLesson {
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subject' })
  subjectId?: Types.ObjectId;

  @Prop({ required: true }) subjectName!: string;

  @Prop({ type: [String], default: [] }) teacherNames!: string[];

  @Prop({ type: String, enum: ['lecture', 'practice', 'lab', 'seminar', 'other'], required: true })
  type!: 'lecture' | 'practice' | 'lab' | 'seminar' | 'other';

  // 1..6 (Mon–Sat, 6-day KPI week)
  @Prop({ required: true, min: 1, max: 6 }) dayOfWeek!: number;
  @Prop({ required: true, min: 1, max: 8 }) lessonNumber!: number;
  @Prop({ required: true }) startTime!: string;
  @Prop({ required: true }) endTime!: string;

  @Prop({ required: true, enum: [0, 1, 2] }) weekType!: 0 | 1 | 2;

  @Prop() room?: string;
  @Prop() meetingUrl?: string;

  @Prop({ default: false }) isElective!: boolean;
  @Prop() electiveTrack?: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  electiveStudentIds!: Types.ObjectId[];
}

export type ScheduleLessonDocument = HydratedDocument<ScheduleLesson>;
export const ScheduleLessonSchema = SchemaFactory.createForClass(ScheduleLesson);
ScheduleLessonSchema.index({ groupId: 1, dayOfWeek: 1, weekType: 1, startTime: 1 });
