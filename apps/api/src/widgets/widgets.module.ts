// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StatsModule } from '../stats/stats.module';
import { DaySummaryLinkController, DaySummaryPublicController } from './day-summary.controller';
import { DaySummaryService } from './day-summary.service';

/**
 * Приватная ссылка «Итог дня» (v2 §7) — личная ссылка владельца. PrismaService — глобальный провайдер.
 */
@Module({
  imports: [AuthModule, StatsModule],
  controllers: [DaySummaryLinkController, DaySummaryPublicController],
  providers: [DaySummaryService],
})
export class WidgetsModule {}
