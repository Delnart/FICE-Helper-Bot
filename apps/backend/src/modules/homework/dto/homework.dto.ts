import { IsBoolean, IsInt, IsISO8601, IsMongoId, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateHomeworkDto {
  @IsMongoId() subjectId!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsISO8601() deadline?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) points?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) teamSize?: number;
}

export class UpdateHomeworkDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsISO8601() deadline?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) points?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) teamSize?: number;
}

export class MarkCompletionDto {
  @IsBoolean() done!: boolean;
}
