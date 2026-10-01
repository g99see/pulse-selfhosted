// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoalsModule } from '../goals/goals.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { StatsModule } from '../stats/stats.module';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';

/** Модуль карточки «Поделиться результатом» (ТЗ §3.7, §4 P1). */
@Module({
  imports: [AuthModule, GoalsModule, AchievementsModule, StatsModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
