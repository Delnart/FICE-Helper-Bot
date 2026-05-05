export enum TeacherRoleInSubject {
  Lecturer = 'lecturer',
  Practice = 'practice',
  Lab = 'lab',
}

export const TEACHER_ROLE_LABEL_UK: Record<TeacherRoleInSubject, string> = {
  [TeacherRoleInSubject.Lecturer]: 'Лектор',
  [TeacherRoleInSubject.Practice]: 'Практик',
  [TeacherRoleInSubject.Lab]: 'Лаборант',
};
