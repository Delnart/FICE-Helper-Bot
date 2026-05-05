import { TeacherRoleInSubject } from '../enums/teacher.enum';

export type SubjectLinkReminderType = 'lecture' | 'practice' | 'lab';

export interface SubjectTeacherRef {
  teacherUserId?: string;
  fullName: string;
  telegramUsername?: string;
  email?: string;
  role: TeacherRoleInSubject;
  externalSource?: 'sheet' | 'manual';
}

export interface SubjectLink {
  label: string;
  url: string;
  teacherUserId?: string;
  showInLessonReminder?: boolean;
  lessonReminderType?: SubjectLinkReminderType;
}

export interface SubjectSettings {
  hideHomework: boolean;
  hideQueue: boolean;
  hideLinks: boolean;
  hideTeachers: boolean;
}

export interface SubjectDto {
  id: string;
  groupId: string;
  name: string;
  shortName?: string;
  campusSubjectId?: string;
  teachers: SubjectTeacherRef[];
  links: SubjectLink[];
  settings: SubjectSettings;
  createdAt: string;
}
