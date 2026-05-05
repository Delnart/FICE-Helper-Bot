import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../types/request-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: RequestUser; activeGroupId?: string }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('No user context');

    const groupId = req.activeGroupId;
    const memberships = groupId
      ? user.memberships.filter((m) => m.groupId === groupId)
      : user.memberships;

    const maxLevel = memberships.reduce((acc, m) => Math.max(acc, ROLE_LEVEL[m.role] ?? 0), 0);
    const required_max = required.reduce((acc, r) => Math.max(acc, ROLE_LEVEL[r] ?? 0), 0);

    if (maxLevel < required_max) {
      throw new ForbiddenException('Insufficient role for this group');
    }
    return true;
  }
}
