// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { SocialPostsService } from './social-posts.service';

/**
 * Листовой модуль создания постов ленты (ТЗ §3.7). Не импортирует ничего,
 * кроме глобального PrismaModule, поэтому его можно подключать из достижений и
 * целей без риска циклических зависимостей Nest.
 */
@Module({
  providers: [SocialPostsService],
  exports: [SocialPostsService],
})
export class SocialPostsModule {}
