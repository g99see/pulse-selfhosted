// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { AuthModule } from '../auth/auth.module';
import { CheckinsController } from './checkins.controller';
import { CheckinsService } from './checkins.service';

/** Модуль чек-инов (ТЗ §3.3): ответ настроением, расширенный чек-ин и расписание. */
@Module({
  imports: [AuthModule, AchievementsModule],
  controllers: [CheckinsController],
  providers: [CheckinsService],
  exports: [CheckinsService],
})
export class CheckinsModule {}
