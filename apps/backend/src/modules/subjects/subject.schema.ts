import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { TeacherRoleInSubject } from '@fice/shared';
import type { SubjectLinkReminderType } from '@fice/shared';

@Schema({ _id: false })
export class SubjectTeacherSub {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
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
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) teacherUserId?: Types.ObjectId;
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
  @Prop({ type: SchemaTypes.ObjectId, ref: 'AcademicGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true }) name!: string;
  @Prop() shortName?: string;
  /** Tile icon override (frontend SUBJECT_ICONS name); unset = picked from the name. */
  @Prop() icon?: string;
  /** Set by the head/deputy: lessons get the «онлайн» chip. Independent of meeting links. */
  @Prop({ default: false }) isOnline!: boolean;
  @Prop({ index: true }) campusSubjectId?: string;

  @Prop({ type: [SubjectTeacherSubSchema], default: [] })
  teachers!: SubjectTeacherSub[];

  @Prop({ type: [SubjectLinkSubSchema], default: [] })
  links!: SubjectLinkSub[];

  @Prop({ type: SubjectSettingsSubSchema, default: () => ({}) })
  settings!: SubjectSettingsSub;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type SubjectDocument = HydratedDocument<Subject>;
export const SubjectSchema = SchemaFactory.createForClass(Subject);
SubjectSchema.index({ groupId: 1, name: 1 }, { unique: true });
// "Subjects I teach" lookups (/users/me, teacher home, lecturer schedule, sheets sync).
SubjectSchema.index({ 'teachers.teacherUserId': 1 });

/** The link a lesson's reminder and /now show: the subject's link flagged for this lesson type, else the lesson's own. */
export function pickLessonLink(
  subject: Pick<Subject, 'links'> | null | undefined,
  lesson: { type?: string; meetingUrl?: string },
): { label: string; url: string } | undefined {
  const reminderLink = subject?.links.find(
    (link) => link.showInLessonReminder && link.lessonReminderType === lesson.type,
  );
  const preferredUrl = reminderLink ? normalizeHttpUrl(reminderLink.url) : undefined;
  if (preferredUrl) {
    return {
      label: reminderLink?.label?.trim() || 'Посилання',
      url: preferredUrl,
    };
  }

  const fallbackUrl = normalizeHttpUrl(lesson.meetingUrl ?? '');
  if (!fallbackUrl) return undefined;
  return { label: 'Зустріч', url: fallbackUrl };
}

function normalizeHttpUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
