// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  StatsCalendarQuerySchema,
  StatsDayQuerySchema,
  StatsReportQuerySchema,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { StatsService } from './stats.service';

/** Статистика (ТЗ §3.4): всё под SessionGuard, только данные текущего пользователя. */
@Controller('stats')
@UseGuards(SessionGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Дашборд дня: траты, остаток бюджета, среднее настроение, число чек-инов. */
  @Get('day')
  async day(@Req() req: AuthenticatedRequest, @Query('date') date?: string) {
    const parsed = StatsDayQuerySchema.safeParse({ date });
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректная дата');
    }
    return this.stats.day(req.user!.id, parsed.data.date);
  }

  /** Отчёт за день/неделю/месяц/год: категории, доходы против расходов, сравнение. */
  @Get('report')
  async report(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = StatsReportQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры отчёта');
    }
    return this.stats.report(req.user!.id, parsed.data.period, parsed.data.date);
  }

  /** Календарь-тепловая карта настроения за месяц. */
  @Get('mood-calendar')
  async moodCalendar(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = StatsCalendarQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректный месяц');
    }
    return this.stats.moodCalendar(req.user!.id, parsed.data.month);
  }
}
