// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Header, Param } from '@nestjs/common';
import { GoalWidgetService } from './goal-widget.service';

/**
 * Публичный виджет цели (ТЗ §4, P3): `GET /api/public/widgets/goal/:goalId`.
 * Доступ без входа и без cookie; ответ читаемый для сторонних сайтов
 * (CORS только на чтение) и кэшируется на 60 секунд.
 */
@Controller('public/widgets')
export class WidgetsController {
  constructor(private readonly widgets: GoalWidgetService) {}

  @Get('goal/:goalId')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'GET')
  @Header('Cache-Control', 'public, max-age=60')
  async goal(@Param('goalId') goalId: string) {
    return { widget: await this.widgets.get(goalId) };
  }
}
