// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SocialPostsModule } from '../social/social-posts.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

/** Модуль достижений и стриков (ТЗ §2, §4). Экспортирует сервис для целей. */
@Module({
  imports: [AuthModule, SocialPostsModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
