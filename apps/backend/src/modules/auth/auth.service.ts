import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from '@fice/shared';
import { User, UserDocument } from '../users/user.schema';
import { verifyAndParseInitData } from './telegram-verify.util';
import { SheetsService } from '../sheets/sheets.service';

export interface AuthResult {
  token: string;
  user: {
    id: string;
    telegramId: number;
    firstName: string;
    lastName?: string;
    username?: string;
    avatarUrl?: string;
    memberships: Array<{ groupId: string; role: Role }>;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sheets: SheetsService,
  ) {}

  async loginWithTelegram(initData: string): Promise<AuthResult> {
    const botToken = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    let parsed;
    try {
      parsed = verifyAndParseInitData(initData, botToken);
    } catch (err) {
      this.logger.warn(`Telegram verify failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid Telegram init data');
    }

    const tgUser = parsed.user;
    if (!tgUser) throw new UnauthorizedException('No user in init data');

    const user = await this.users.findOneAndUpdate(
      { telegramId: tgUser.id },
      {
        $set: {
          firstName: tgUser.first_name,
          lastName: tgUser.last_name,
          username: tgUser.username,
          avatarUrl: tgUser.photo_url,
          lastSeenAt: new Date(),
        },
        $setOnInsert: { memberships: [] },
      },
      { upsert: true, new: true },
    );

    if (user.isBanned) throw new UnauthorizedException('User is banned');

    // If the user has no fullName yet but their @username is in the sheets,
    // pre-fill from there so journals/profile show their canonical ПІБ instead
    // of the Telegram first name. Cheap because sheets are cached in memory.
    if (!user.fullName && user.username && this.sheets.isConfigured()) {
      try {
        const fromHeads = await this.sheets.findHead(user.username);
        const fromTeachers = !fromHeads
          ? await this.sheets.findTeacherByUsername(user.username)
          : undefined;
        const sheetName = fromHeads?.fullName ?? fromTeachers?.fullName;
        if (sheetName) {
          user.fullName = sheetName;
          await user.save();
        }
      } catch (err) {
        this.logger.warn(`fullName pre-fill failed: ${(err as Error).message}`);
      }
    }

    const memberships = user.memberships.map((m) => ({
      groupId: String(m.groupId),
      role: m.role,
    }));

    const token = await this.jwt.signAsync(
      {
        userId: String(user._id),
        telegramId: user.telegramId,
        memberships,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '7d',
      },
    );

    return {
      token,
      user: {
        id: String(user._id),
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        memberships,
      },
    };
  }
}
