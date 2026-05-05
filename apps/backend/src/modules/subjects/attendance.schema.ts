import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'attendance_sessions' })
export class AttendanceSession {
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  teacherUserId!: Types.ObjectId;

  @Prop({ required: true }) date!: Date;
  @Prop() lessonNumber?: number;
  @Prop() note?: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  presentStudentIds!: Types.ObjectId[];
}

export type AttendanceSessionDocument = HydratedDocument<AttendanceSession>;
export const AttendanceSessionSchema = SchemaFactory.createForClass(AttendanceSession);
