import { Role } from '../enums/role.enum';

export interface GroupMembership {
  groupId: string;
  role: Role;
  joinedAt: string;
}

export interface UserDto {
  id: string;
  telegramId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  fullName?: string;
  avatarUrl?: string;
  email?: string;
  birthday?: string;
  memberships: GroupMembership[];
  createdAt: string;
}
