import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Role, ROLE_LEVEL } from '@fice/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) throw new ForbiddenException('No user context');

    // Raw header, not req.activeGroupId: JwtAuthGuard drops a header naming a
    // foreign group, and falling back to ALL memberships here would let that
    // request pass on a role held in some other group.
    const groupId = req.header('x-group-id');
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
