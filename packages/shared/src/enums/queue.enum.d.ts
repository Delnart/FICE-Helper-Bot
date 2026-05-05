export declare enum QueueStatus {
    Default = "default",
    Preparing = "preparing",
    Passing = "passing",
    Passed = "passed",
    Missed = "missed",
    Failed = "failed"
}
export declare const QUEUE_STATUS_LABEL_UK: Record<QueueStatus, string>;
export declare const MAX_QUEUE_SLOTS = 50;
