// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckinsModule } from '../checkins/checkins.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StatsModule } from '../stats/stats.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { InsightsScheduler } from './weekly.scheduler';

/** Инсайты на правилах и недельный разбор (ТЗ §3.5). */
@Module({
  imports: [AuthModule, StatsModule, CheckinsModule, FinanceModule, NotificationsModule],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsScheduler],
  exports: [InsightsService, InsightsScheduler],
})
export class InsightsModule {}
