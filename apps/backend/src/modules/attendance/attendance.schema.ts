import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AttendanceStatus } from '@fice/shared';

@Schema({ _id: false })
export class AttendanceEntrySub {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AttendanceStatus), default: AttendanceStatus.Unknown })
  status!: AttendanceStatus;

  @Prop() note?: string;
}
const AttendanceEntrySubSchema = SchemaFactory.createForClass(AttendanceEntrySub);

@Schema({ timestamps: true, collection: 'attendance_records' })
export class AttendanceRecord {
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ScheduleLesson', required: true, index: true })
  scheduleLessonId!: Types.ObjectId;

  @Prop({ required: true, type: Date, index: true })
  date!: Date;

  @Prop({ type: [AttendanceEntrySubSchema], default: [] })
  entries!: AttendanceEntrySub[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type AttendanceRecordDocument = HydratedDocument<AttendanceRecord>;
export const AttendanceRecordSchema = SchemaFactory.createForClass(AttendanceRecord);
AttendanceRecordSchema.index({ groupId: 1, scheduleLessonId: 1, date: 1 }, { unique: true });
