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

    try {
      const payload = await this.jwt.verifyAsync<{
        userId: string;
        telegramId: number;
        iat: number;
        exp: number;
      }>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });

      // Re-read memberships fresh from DB every request.
      // The JWT only proves identity (userId + telegramId); roles come from DB.
      const dbUser = await this.userModel.findById(payload.userId).lean().exec();
      if (dbUser?.isBanned) throw new UnauthorizedException('User is banned');
      const memberships: RequestUser['memberships'] = (dbUser?.memberships ?? []).map((m) => ({
        groupId: String(m.groupId),
        role: m.role,
      }));

      req.user = {
        userId: payload.userId,
        telegramId: payload.telegramId,
        memberships,
      };
      const groupIdHeader = req.header('x-group-id');
      if (groupIdHeader) req.activeGroupId = groupIdHeader;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
