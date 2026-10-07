// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../moderation/roles.guard';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

/** Модуль достижений и стриков (ТЗ v2 §4). Экспортирует сервис для событийных хуков. */
@Module({
  imports: [AuthModule],
  controllers: [AchievementsController],
  providers: [AchievementsService, RolesGuard],
  exports: [AchievementsService],
})
export class AchievementsModule {}
