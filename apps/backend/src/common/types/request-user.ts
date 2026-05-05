import { Role } from '@fice/shared';

export interface RequestUser {
  userId: string;
  telegramId: number;
  memberships: Array<{ groupId: string; role: Role }>;
}

declare module 'express' {
  interface Request {
    user?: RequestUser;
    activeGroupId?: string;
  }
}
