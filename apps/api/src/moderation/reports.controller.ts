// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ReportCreateSchema, type ReportCreateInput } from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ModerationService } from './moderation.service';

/**
 * Приём жалоб (ТЗ §3.7): любой вошедший пользователь может пожаловаться на
 * профиль, пост, комментарий или HTML-страницу. Ограничение частоты, запрет
 * жалоб на себя и защита от дублей — в ModerationService.
 */
@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(ReportCreateSchema)) body: ReportCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.moderation.createReport(req.user!.id, body);
  }
}
