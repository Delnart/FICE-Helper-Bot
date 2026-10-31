import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'schedule_lessons' })
export class ScheduleLesson {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject' })
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

  // The only calendar days ("YYYY-MM-DD", from Campus) the lesson runs on, sorted.
  // Empty, or absent on a doc not re-synced yet = every week of its weekType.
  @Prop({ type: [String], default: [] }) dates?: string[];

  @Prop() room?: string;
  @Prop() meetingUrl?: string;

  @Prop({ default: false }) isElective!: boolean;
  @Prop() electiveTrack?: string;

  @Prop({ type: [{ type: SchemaTypes.ObjectId, ref: 'User' }], default: [] })
  electiveStudentIds!: Types.ObjectId[];
}

export type ScheduleLessonDocument = HydratedDocument<ScheduleLesson>;
export const ScheduleLessonSchema = SchemaFactory.createForClass(ScheduleLesson);
ScheduleLessonSchema.index({ groupId: 1, dayOfWeek: 1, weekType: 1, startTime: 1 });

/** The calendar day of `d` in local time (Kyiv, TZ is set in production), as "YYYY-MM-DD". */
export function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The one rule for "does this lesson run on `day`" ("YYYY-MM-DD"); weekday and parity are the caller's filter. */
export function runsOn(lesson: { dates?: string[] }, day: string): boolean {
  return !lesson.dates?.length || lesson.dates.includes(day);
}
