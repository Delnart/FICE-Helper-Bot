import { AttendanceStatus } from '../enums/attendance.enum';
export interface AttendanceRecordDto {
    id: string;
    groupId: string;
    scheduleLessonId: string;
    date: string;
    entries: Array<{
        userId: string;
        status: AttendanceStatus;
        note?: string;
    }>;
    createdBy: string;
    updatedAt: string;
}
