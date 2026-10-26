import { QueueStatus } from '../enums/queue.enum';

export interface QueueEntry {
  slotIndex: number;
  userId: string;
  labNumber: number;
  status: QueueStatus;
  enrolledAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface QueueRules {
  allowMultipleEntriesPerUser: boolean;
  allowGroupSubmission: boolean;
  isOpen: boolean;
  autoOpenAt?: string;
  autoCloseAt?: string;
  autoCompact?: boolean;
}

export interface QueueDto {
  id: string;
  subjectId: string;
  groupId: string;
  title: string;
  slotsCount: number;
  rules: QueueRules;
  entries: QueueEntry[];
  createdAt: string;
}
