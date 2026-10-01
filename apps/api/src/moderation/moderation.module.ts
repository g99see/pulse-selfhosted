// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModerationController } from './moderation.controller';
import { ReportsController } from './reports.controller';
import { ModerationService } from './moderation.service';
import { RolesGuard } from './roles.guard';

/**
 * Жалобы и модерация (ТЗ §3.7, §3.8, §2). ModerationService экспортируется,
 * чтобы лента, профиль и HTML-страницы могли спрашивать isHidden().
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController, ModerationController],
  providers: [ModerationService, RolesGuard],
  exports: [ModerationService],
})
export class ModerationModule {}
