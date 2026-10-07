// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionGuard } from '../auth/session.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AchievementsService } from './achievements.service';

/** Достижения и стрики (ТЗ v2 §4) — всё под SessionGuard и по текущему пользователю. */
@Controller('achievements')
@UseGuards(SessionGuard, RolesGuard)
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.achievements.list(req.user!.id);
  }

  @Get('streak')
  streak(@Req() req: AuthenticatedRequest) {
    return this.achievements.streak(req.user!.id);
  }

  /** Админ: тихий пересчёт достижений всех пользователей (без уведомлений). */
  @Post('backfill')
  @HttpCode(200)
  @Roles('admin')
  backfill() {
    return this.achievements.backfillAll();
  }
}
