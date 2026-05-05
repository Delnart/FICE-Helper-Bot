import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

/** Sent by the teacher to link their campus lecturer profile and auto-discover subjects. */
export class IdentifyTeacherDto {
  /** Override the name to search (defaults to user.fullName). */
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  /** Skip name search and directly confirm a known campus lecturer ID. */
  @IsOptional() @IsString() @MaxLength(200) lecturerId?: string;
}

export class ApplyTeacherDto {
  @IsMongoId() subjectId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Teacher requests access to a group (group-level join request). */
export class GroupJoinRequestDto {
  @IsMongoId() groupId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class InviteTeacherDto {
  @IsMongoId() subjectId!: string;
  @IsMongoId() teacherUserId!: string;
}

export class DecideApplicationDto {
  @IsString() action!: 'approve' | 'reject';
}
