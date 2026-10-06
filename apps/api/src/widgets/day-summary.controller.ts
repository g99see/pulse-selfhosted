// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { DaySummaryService } from './day-summary.service';

/** Управление приватной ссылкой «Итог дня» — только владелец, под сессией. */
@Controller('day-summary-link')
@UseGuards(SessionGuard)
export class DaySummaryLinkController {
  constructor(private readonly summary: DaySummaryService) {}

  @Get()
  status(@Req() req: AuthenticatedRequest) {
    return this.summary.status(req.user!.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: AuthenticatedRequest) {
    return this.summary.create(req.user!.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.summary.revoke(req.user!.id);
  }
}

/** Публичные итоги дня по секретному токену; не кэшируются и не индексируются. */
@Controller('public/day-summary')
export class DaySummaryPublicController {
  constructor(private readonly summary: DaySummaryService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async get(@Param('token') token: string) {
    return { summary: await this.summary.publicSummary(token) };
  }
}
