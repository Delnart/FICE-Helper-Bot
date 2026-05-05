import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsMongoId() groupId!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsBoolean() broadcastToChat?: boolean;
}

export class UpdatePrefsDto {
  @IsOptional() @IsBoolean() dmQueueOpen?: boolean;
  @IsOptional() @IsBoolean() dmNextInQueue?: boolean;
  @IsOptional() @IsBoolean() dmDeadlineTomorrow?: boolean;
  @IsOptional() @IsBoolean() dmSwapRequests?: boolean;
}
