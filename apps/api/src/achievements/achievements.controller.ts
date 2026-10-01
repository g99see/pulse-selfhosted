// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionGuard } from '../auth/session.guard';
import { AchievementsService } from './achievements.service';

/** Достижения и стрики (ТЗ §4) — всё под SessionGuard и по текущему пользователю. */
@Controller('achievements')
@UseGuards(SessionGuard)
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
}
