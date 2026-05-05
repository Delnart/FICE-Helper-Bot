import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'teacher_applications' })
export class TeacherApplication {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  teacherUserId!: Types.ObjectId;

  /**
   * For subject-level applications (teacher wants to be linked to a specific subject).
   * Mutually exclusive with `groupId`.
   */
  @Prop({ type: Types.ObjectId, ref: 'Subject' })
  subjectId?: Types.ObjectId;

  /**
   * For group-level join requests (teacher wants access to the group to view queue / journal).
   * Mutually exclusive with `subjectId`.
   */
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup' })
  groupId?: Types.ObjectId;

  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status!: 'pending' | 'approved' | 'rejected';

  /** Optional message the teacher writes to the head. */
  @Prop() note?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  decidedBy?: Types.ObjectId;
}

export type TeacherApplicationDocument = HydratedDocument<TeacherApplication>;
export const TeacherApplicationSchema = SchemaFactory.createForClass(TeacherApplication);
TeacherApplicationSchema.index({ teacherUserId: 1, groupId: 1, status: 1 });
TeacherApplicationSchema.index({ groupId: 1, status: 1 });
