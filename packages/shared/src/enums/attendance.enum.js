"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATTENDANCE_STATUS_LABEL_UK = exports.AttendanceStatus = void 0;
var AttendanceStatus;
(function (AttendanceStatus) {
    AttendanceStatus["Present"] = "present";
    AttendanceStatus["Absent"] = "absent";
    AttendanceStatus["Excused"] = "excused";
    AttendanceStatus["Late"] = "late";
    AttendanceStatus["Unknown"] = "unknown";
})(AttendanceStatus || (exports.AttendanceStatus = AttendanceStatus = {}));
exports.ATTENDANCE_STATUS_LABEL_UK = {
    [AttendanceStatus.Present]: 'Присутній',
    [AttendanceStatus.Absent]: 'Відсутній',
    [AttendanceStatus.Excused]: 'Поважна причина',
    [AttendanceStatus.Late]: 'Запізнився',
    [AttendanceStatus.Unknown]: 'Не відмічено',
};
//# sourceMappingURL=attendance.enum.js.map