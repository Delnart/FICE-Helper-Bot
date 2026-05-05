import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TeacherRoleInSubject } from '@fice/shared';

export class SubjectTeacherDto {
  @IsOptional() @IsMongoId() teacherUserId?: string;
  @IsString() @MinLength(2) @MaxLength(200) fullName!: string;
  @IsOptional() @IsString() @MaxLength(100) telegramUsername?: string;
  @IsEnum(TeacherRoleInSubject) role!: TeacherRoleInSubject;
}

export class SubjectLinkDto {
  @IsString() @MinLength(1) @MaxLength(200) label!: string;
  @IsString() @MaxLength(2000) url!: string;
  @IsOptional() @IsMongoId() teacherUserId?: string;
  @IsOptional() @IsBoolean() showInLessonReminder?: boolean;
  @IsOptional() @IsIn(['lecture', 'practice', 'lab']) lessonReminderType?: 'lecture' | 'practice' | 'lab';
}

export class SubjectSettingsDto {
  @IsOptional() @IsBoolean() hideHomework?: boolean;
  @IsOptional() @IsBoolean() hideQueue?: boolean;
  @IsOptional() @IsBoolean() hideLinks?: boolean;
  @IsOptional() @IsBoolean() hideTeachers?: boolean;
}

export class CreateSubjectDto {
  @IsMongoId() groupId!: string;
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(50) shortName?: string;
  @IsOptional() @IsString() campusSubjectId?: string;

  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SubjectTeacherDto)
  teachers!: SubjectTeacherDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SubjectLinkDto)
  links?: SubjectLinkDto[];
}

export class UpdateSubjectDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(50) shortName?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SubjectTeacherDto)
  teachers?: SubjectTeacherDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SubjectLinkDto)
  links?: SubjectLinkDto[];

  @IsOptional() @ValidateNested() @Type(() => SubjectSettingsDto)
  settings?: SubjectSettingsDto;
}
