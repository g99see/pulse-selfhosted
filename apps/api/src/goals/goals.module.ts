// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SocialPostsModule } from '../social/social-posts.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

/** Цели накоплений (ТЗ §3.2): всё под SessionGuard, данные текущего пользователя. */
@Module({
  imports: [AuthModule, SocialPostsModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
