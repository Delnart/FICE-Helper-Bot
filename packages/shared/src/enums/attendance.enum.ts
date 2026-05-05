export enum AttendanceStatus {
  Present = 'present',
  Absent = 'absent',
  Excused = 'excused',
  Late = 'late',
  Unknown = 'unknown',
}

export const ATTENDANCE_STATUS_LABEL_UK: Record<AttendanceStatus, string> = {
  [AttendanceStatus.Present]: 'Присутній',
  [AttendanceStatus.Absent]: 'Відсутній',
  [AttendanceStatus.Excused]: 'Поважна причина',
  [AttendanceStatus.Late]: 'Запізнився',
  [AttendanceStatus.Unknown]: 'Не відмічено',
};
