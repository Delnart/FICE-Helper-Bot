import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsISO8601, IsMongoId, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AttendanceStatus } from '@fice/shared';

export class AttendanceEntryDto {
  @IsMongoId() userId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class UpsertAttendanceDto {
  @IsMongoId() scheduleLessonId!: string;
  @IsISO8601() date!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}
