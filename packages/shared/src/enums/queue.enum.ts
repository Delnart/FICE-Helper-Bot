export enum QueueStatus {
  Default = 'default',
  Preparing = 'preparing',
  Passing = 'passing',
  Passed = 'passed',
  Missed = 'missed',
  Failed = 'failed',
}

export const QUEUE_STATUS_LABEL_UK: Record<QueueStatus, string> = {
  [QueueStatus.Default]: 'Очікує',
  [QueueStatus.Preparing]: 'Готується',
  [QueueStatus.Passing]: 'Здає',
  [QueueStatus.Passed]: 'Здав',
  [QueueStatus.Missed]: 'Пропустив',
  [QueueStatus.Failed]: 'Не здав',
};

export const MAX_QUEUE_SLOTS = 50;
