"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_LEVEL = exports.Role = void 0;
var Role;
(function (Role) {
    Role["Student"] = "student";
    Role["DeputyHead"] = "deputy_head";
    Role["GroupHead"] = "group_head";
    Role["Teacher"] = "teacher";
    Role["Admin"] = "admin";
})(Role || (exports.Role = Role = {}));
exports.ROLE_LEVEL = {
    [Role.Student]: 1,
    [Role.Teacher]: 2,
    [Role.DeputyHead]: 3,
    [Role.GroupHead]: 4,
    [Role.Admin]: 99,
};
//# sourceMappingURL=role.enum.js.map