export interface AcademicGroupDto {
    id: string;
    academicName: string;
    telegramChatId: number;
    campusGroupId?: string;
    headUserId?: string;
    deputyUserIds: string[];
    notificationsEnabled: boolean;
    lessonReminderMinutes: number;
    createdAt: string;
}
