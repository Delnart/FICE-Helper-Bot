import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService, AuthResult } from './auth.service';
import { LoginWithTelegramDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  async loginWithTelegram(@Body() dto: LoginWithTelegramDto): Promise<AuthResult> {
    return this.auth.loginWithTelegram(dto.initData);
  }
}
