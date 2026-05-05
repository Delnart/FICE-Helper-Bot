import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginWithTelegramDto {
  @IsString()
  @MaxLength(8192)
  initData!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  startParam?: string;
}
