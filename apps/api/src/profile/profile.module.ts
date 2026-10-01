// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { AuthModule } from '../auth/auth.module';
import { GoalsModule } from '../goals/goals.module';
import { StatsModule } from '../stats/stats.module';
import { ProfileController } from './profile.controller';
import { PublicProfilesController } from './public-profiles.controller';
import { ProfileService } from './profile.service';

/**
 * Публичный профиль (ТЗ §3.7): свой профиль под редактором и публичная
 * страница /@nickname. Данные карточек берутся из целей, достижений и
 * статистики — модули подключаются как источники.
 */
@Module({
  imports: [AuthModule, GoalsModule, AchievementsModule, StatsModule],
  controllers: [ProfileController, PublicProfilesController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
