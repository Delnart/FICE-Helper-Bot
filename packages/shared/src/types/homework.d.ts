export interface HomeworkDto {
    id: string;
    subjectId: string;
    groupId: string;
    title: string;
    description?: string;
    deadline?: string;
    points?: number;
    teamSize: number;
    createdBy: string;
    createdAt: string;
}
export interface HomeworkCompletionDto {
    homeworkId: string;
    userId: string;
    done: boolean;
    doneAt?: string;
}
