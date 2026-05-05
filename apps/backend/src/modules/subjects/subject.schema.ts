import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TeacherRoleInSubject } from '@fice/shared';
import type { SubjectLinkReminderType } from '@fice/shared';

@Schema({ _id: false })
export class SubjectTeacherSub {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  teacherUserId?: Types.ObjectId;

  @Prop({ required: true }) fullName!: string;
  @Prop() telegramUsername?: string;

  @Prop({ type: String, enum: Object.values(TeacherRoleInSubject), required: true })
  role!: TeacherRoleInSubject;

  @Prop({ type: String, enum: ['sheet', 'manual'], default: 'manual' })
  externalSource!: 'sheet' | 'manual';
}
const SubjectTeacherSubSchema = SchemaFactory.createForClass(SubjectTeacherSub);

@Schema({ _id: false })
export class SubjectLinkSub {
  @Prop({ required: true }) label!: string;
  @Prop({ required: true }) url!: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) teacherUserId?: Types.ObjectId;
  @Prop({ default: false }) showInLessonReminder!: boolean;
  @Prop({ type: String, enum: ['lecture', 'practice', 'lab'] })
  lessonReminderType?: SubjectLinkReminderType;
}
const SubjectLinkSubSchema = SchemaFactory.createForClass(SubjectLinkSub);

@Schema({ _id: false })
export class SubjectSettingsSub {
  @Prop({ default: false }) hideHomework!: boolean;
  @Prop({ default: false }) hideQueue!: boolean;
  @Prop({ default: false }) hideLinks!: boolean;
  @Prop({ default: false }) hideTeachers!: boolean;
}
const SubjectSettingsSubSchema = SchemaFactory.createForClass(SubjectSettingsSub);

@Schema({ timestamps: true, collection: 'subjects' })
export class Subject {
  @Prop({ type: Types.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true }) name!: string;
  @Prop() shortName?: string;
  @Prop({ index: true }) campusSubjectId?: string;

  @Prop({ type: [SubjectTeacherSubSchema], default: [] })
  teachers!: SubjectTeacherSub[];

  @Prop({ type: [SubjectLinkSubSchema], default: [] })
  links!: SubjectLinkSub[];

  @Prop({ type: SubjectSettingsSubSchema, default: () => ({}) })
  settings!: SubjectSettingsSub;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type SubjectDocument = HydratedDocument<Subject>;
export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.index({ groupId: 1, name: 1 }, { unique: true });
