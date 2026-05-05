export interface ScheduleLessonDto {
  id: string;
  subjectId?: string;
  subjectName: string;
  teacherNames: string[];
  type: 'lecture' | 'practice' | 'lab' | 'seminar' | 'other';
  dayOfWeek: number;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  weekType: 1 | 2 | 0;
  room?: string;
  meetingUrl?: string;
  isElective: boolean;
  electiveTrack?: string;
}
