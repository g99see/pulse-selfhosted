// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StatsModule } from '../stats/stats.module';
import { DaySummaryLinkController, DaySummaryPublicController } from './day-summary.controller';
import { DaySummaryService } from './day-summary.service';
import { GoalWidgetService } from './goal-widget.service';
import { WidgetsController } from './widgets.controller';

/**
 * Виджеты без входа (ТЗ §4, P3; v2 §7): виджет цели и приватная ссылка
 * «Итог дня». PrismaService — глобальный провайдер.
 */
@Module({
  imports: [AuthModule, StatsModule],
  controllers: [WidgetsController, DaySummaryLinkController, DaySummaryPublicController],
  providers: [GoalWidgetService, DaySummaryService],
})
export class WidgetsModule {}
