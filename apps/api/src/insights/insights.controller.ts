// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Инсайты (ТЗ §3.5): лента рекомендаций на правилах, оценка «полезно / не
 * полезно» и применение предложения кнопкой. Всё под SessionGuard и только
 * по данным текущего пользователя.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InsightFeedbackInputSchema, InsightsListQuerySchema, type InsightFeedbackInput } from '@puls/shared';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { InsightsService } from './insights.service';

@Controller('insights')
@UseGuards(SessionGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Лента инсайтов пользователя (генерирует свежие за сегодня). */
  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = InsightsListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры');
    }
    return this.insights.list(req.user!.id, parsed.data.limit);
  }

  /** Последний инсайт — блок на главной. */
  @Get('latest')
  async latest(@Req() req: AuthenticatedRequest) {
    return { insight: await this.insights.latest(req.user!.id) };
  }

  /** Последний недельный разбор, если он уже собран. */
  @Get('weekly')
  async weekly(@Req() req: AuthenticatedRequest) {
    return this.insights.latestWeekly(req.user!.id);
  }

  /** Оценка «полезно / не полезно» — влияет на показ типа. */
  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  async feedback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InsightFeedbackInputSchema)) body: InsightFeedbackInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.insights.feedback(req.user!.id, id, body.feedback);
  }

  /** «Применить» предложение — создаёт бюджет через сервис финансов. */
  @Post(':id/apply')
  @HttpCode(HttpStatus.CREATED)
  async apply(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.insights.apply(req.user!.id, id);
  }

  /** Ручная генерация инсайтов за сегодня (идемпотентно). */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Req() req: AuthenticatedRequest) {
    return { insights: await this.insights.generate(req.user!.id) };
  }
}
