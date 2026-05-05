export enum Role {
  Student = 'student',
  DeputyHead = 'deputy_head',
  GroupHead = 'group_head',
  Teacher = 'teacher',
  Admin = 'admin',
}

export const ROLE_LEVEL: Record<Role, number> = {
  [Role.Student]: 1,
  [Role.Teacher]: 2,
  [Role.DeputyHead]: 3,
  [Role.GroupHead]: 4,
  [Role.Admin]: 99,
};
