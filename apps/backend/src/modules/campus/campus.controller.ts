import { Controller, Get, Query } from '@nestjs/common';
import { CampusService } from './campus.service';

@Controller('campus')
export class CampusController {
  constructor(private readonly campus: CampusService) {}

  @Get('groups')
  async groups(@Query('q') q?: string) {
    if (!q || q.trim().length < 2) return [];
    return this.campus.findGroupByName(q.trim());
  }
}
