import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RequestUser } from '../types/request-user';
import { User, UserDocument } from '../../modules/users/user.schema';
import { GroupAccessService } from '../access/group-access';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    // Fresh memberships are always read from DB so role changes (assign deputy,
    // add member, remove from group) take effect on the very next request —
    // users never need to re-login after a role change.
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly access: GroupAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.slice(7);

    let payload: { userId: string; telegramId: number };
    try {
      payload = await this.jwt.verifyAsync<{ userId: string; telegramId: number }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // Re-read memberships fresh from DB every request.
    // The JWT only proves identity (userId + telegramId); roles come from DB.
    // Deliberately outside the try: a slow / restarting Mongo must surface as a
    // 5xx — the Mini App treats 401 as an expired session and re-logs in, which
    // turned every DB hiccup into a login storm and "lost" roles.
    const dbUser = await this.userModel
      .findById(payload.userId, { memberships: 1, isBanned: 1 })
      .lean()
      .exec();
    if (dbUser?.isBanned) throw new UnauthorizedException('User is banned');
    const memberships: RequestUser['memberships'] = (dbUser?.memberships ?? []).map((m) => ({
      groupId: String(m.groupId),
      role: m.role,
    }));

    const user: RequestUser = { userId: payload.userId, telegramId: payload.telegramId, memberships };
    req.user = user;
    // @ActiveGroupId() handlers trust this, so keep it only for a group the user
    // is in (or teaches in). No throw: group-less routes (/users/me) still get a
    // stale header, and the frontend re-validates its active group itself.
    const groupIdHeader = req.header('x-group-id');
    if (groupIdHeader && (await this.access.roleIn(user, groupIdHeader)) !== null) {
      req.activeGroupId = groupIdHeader;
    }
    return true;
  }
}
