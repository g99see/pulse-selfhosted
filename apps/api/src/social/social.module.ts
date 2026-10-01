// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocialController } from './social.controller';
import { SocialPostsModule } from './social-posts.module';
import { SocialService } from './social.service';

/**
 * Социальный модуль (ТЗ §3.7): подписки, лента, реакции и комментарии.
 * Зависит от NotificationsModule (уведомление reactions владельцу поста) и
 * AuthModule (SessionGuard, RateLimitService). Сервис создания постов вынесен
 * в листовой SocialPostsModule — его импортируют достижения и цели без цикла.
 */
@Module({
  imports: [AuthModule, NotificationsModule, SocialPostsModule],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService, SocialPostsModule],
})
export class SocialModule {}
