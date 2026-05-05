"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_QUEUE_SLOTS = exports.QUEUE_STATUS_LABEL_UK = exports.QueueStatus = void 0;
var QueueStatus;
(function (QueueStatus) {
    QueueStatus["Default"] = "default";
    QueueStatus["Preparing"] = "preparing";
    QueueStatus["Passing"] = "passing";
    QueueStatus["Passed"] = "passed";
    QueueStatus["Missed"] = "missed";
    QueueStatus["Failed"] = "failed";
})(QueueStatus || (exports.QueueStatus = QueueStatus = {}));
exports.QUEUE_STATUS_LABEL_UK = {
    [QueueStatus.Default]: 'Очікує',
    [QueueStatus.Preparing]: 'Готується',
    [QueueStatus.Passing]: 'Здає',
    [QueueStatus.Passed]: 'Здав',
    [QueueStatus.Missed]: 'Пропустив',
    [QueueStatus.Failed]: 'Не здав',
};
exports.MAX_QUEUE_SLOTS = 50;
//# sourceMappingURL=queue.enum.js.map