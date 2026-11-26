import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { type AuthRequest, Roles } from '../auth/auth.guard.js';
import { SourcesService, SourcesStatus, SyncResult } from './sources.service.js';

@Controller('admin/sources')
@Roles('admin')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  /** Notes and URLs now instead of at the next interval (M3c.1). */
  @Post('sync')
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: SyncResult })
  sync(@Req() req: AuthRequest): Promise<SyncResult> {
    return this.sources.sync(req.id as string);
  }

  /** What the last sync read and indexed per folder, document counts as they are now (D127). */
  @Get('status')
  @ApiOkResponse({ standardSchema: SourcesStatus.nullable() })
  status(@Req() req: AuthRequest): Promise<SourcesStatus | null> {
    return this.sources.status(req.id as string);
  }
}
