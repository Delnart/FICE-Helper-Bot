import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'attendance_sessions' })
export class AttendanceSession {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Subject', required: true, index: true })
  subjectId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  teacherUserId!: Types.ObjectId;

  @Prop({ required: true }) date!: Date;
  @Prop() lessonNumber?: number;
  @Prop() note?: string;

  @Prop({ type: [{ type: SchemaTypes.ObjectId, ref: 'User' }], default: [] })
  presentStudentIds!: Types.ObjectId[];
}

export type AttendanceSessionDocument = HydratedDocument<AttendanceSession>;
export const AttendanceSessionSchema = SchemaFactory.createForClass(AttendanceSession);
