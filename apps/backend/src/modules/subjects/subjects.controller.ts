import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto, SubjectLinkDto, UpdateSubjectDto } from './dto/subject.dto';
import { CurrentUser, ActiveGroupId } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/request-user';

class UpdateLinksDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SubjectLinkDto)
  links!: SubjectLinkDto[];
}

class CreateSessionDto {
  @IsDateString() date!: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) lessonNumber?: number;
  @IsOptional() @IsString() note?: string;
  @IsArray() presentStudentIds!: string[];
}

class UpdateSessionDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsArray() presentStudentIds?: string[];
}

@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  async list(
    @Query('groupId') groupIdQuery: string | undefined,
    @ActiveGroupId() activeGroupId: string | undefined,
  ) {
    const groupId = groupIdQuery ?? activeGroupId;
    if (!groupId) throw new BadRequestException('No active group');
    return this.subjects.list(groupId);
  }

  @Get('teachers/suggest')
  async suggest(@Query('q') q: string) {
    return this.subjects.suggestTeachers(q ?? '');
  }

  /**
   * Pre-filled teacher list for a (group, subjectName) pair pulled from the
   * Campus group-schedule. Each suggestion comes with the role(s) (lecturer,
   * practice, lab) the lecturer has on this subject in this group, plus a
   * Telegram tag if we can resolve them in the «Викладачі» sheet.
   */
  @Get('teachers/suggest-from-campus')
  async suggestFromCampus(
    @Query('groupId') groupId: string,
    @Query('subjectName') subjectName: string,
  ) {
    if (!groupId || !subjectName) return [];
    return this.subjects.suggestTeachersFromCampus(groupId, subjectName);
  }

  @Get(':id')
  async one(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.subjects.findOneForUser(user, id);
  }

  @Post()
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateSubjectDto) {
    return this.subjects.create(user, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.subjects.update(user, id, dto);
  }

  /**
   * Teacher-accessible endpoint for managing useful links.
   * Heads/deputies can also use this; in addition they can use PATCH /:id
   * to update everything else at once.
   */
  @Patch(':id/links')
  async updateLinks(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLinksDto,
  ) {
    return this.subjects.updateLinks(user, id, dto.links);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.subjects.remove(user, id);
    return { ok: true };
  }

  // ── Students list ──────────────────────────────────────────────────────────

  @Get(':id/students')
  async students(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.subjects.getGroupStudents(user, id);
  }

  // ── Attendance journal ─────────────────────────────────────────────────────

  @Get(':id/journal')
  async listJournal(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.subjects.listJournalSessions(user, id);
  }

  @Get(':id/journal/:sessionId')
  async getJournal(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.subjects.getJournalSession(user, id, sessionId);
  }

  @Post(':id/journal')
  async createJournal(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateSessionDto,
  ) {
    return this.subjects.createJournalSession(user, id, dto);
  }

  @Patch(':id/journal/:sessionId')
  async updateJournal(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.subjects.updateJournalSession(user, id, sessionId, dto);
  }
}
