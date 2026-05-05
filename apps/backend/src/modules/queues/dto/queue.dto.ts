import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_QUEUE_SLOTS, QueueStatus } from '@fice/shared';

export class QueueRulesDto {
  @IsOptional() @IsBoolean() allowMultipleEntriesPerUser?: boolean;
  @IsOptional() @IsBoolean() allowGroupSubmission?: boolean;
  @IsOptional() @IsBoolean() isOpen?: boolean;
  @IsOptional() @IsISO8601() autoOpenAt?: string;
  @IsOptional() @IsISO8601() autoCloseAt?: string;
}

export class CreateQueueDto {
  @IsMongoId() subjectId!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsInt() @Min(1) @Max(MAX_QUEUE_SLOTS) slotsCount!: number;
  @IsOptional() @ValidateNested() @Type(() => QueueRulesDto) rules?: QueueRulesDto;
}

export class UpdateQueueDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_QUEUE_SLOTS) slotsCount?: number;
  @IsOptional() @ValidateNested() @Type(() => QueueRulesDto) rules?: QueueRulesDto;
}

export class EnrollDto {
  @IsInt() @Min(1) slotIndex!: number;
  @IsInt() @Min(1) labNumber!: number;
}

export class AdminEnrollDto extends EnrollDto {
  @IsMongoId() userId!: string;
}

export class UpdateEntryDto {
  @IsOptional() @IsInt() @Min(1) labNumber?: number;
  @IsOptional() @IsEnum(QueueStatus) status?: QueueStatus;
}

export class RequestSwapDto {
  @IsInt() @Min(1) targetSlotIndex!: number;
}
