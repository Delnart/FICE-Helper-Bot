import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNumber,
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

/**
 * Cap on the lab number — anything past 50 is almost certainly a typo.
 * Sub-labs like "3.1" / "3.2" are allowed: one decimal place, still ≤ 50.
 */
const MAX_LAB_NUMBER = 50;

export class EnrollDto {
  @IsInt() @Min(1) slotIndex!: number;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0.1) @Max(MAX_LAB_NUMBER) labNumber!: number;
}

export class AdminEnrollDto extends EnrollDto {
  @IsMongoId() userId!: string;
}

export class UpdateEntryDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.1)
  @Max(MAX_LAB_NUMBER)
  labNumber?: number;
  @IsOptional() @IsEnum(QueueStatus) status?: QueueStatus;
}

export class RequestSwapDto {
  @IsInt() @Min(1) targetSlotIndex!: number;
}
