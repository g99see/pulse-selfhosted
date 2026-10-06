// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Модуль Discord-бота. Клиент создаётся по окружению (DISCORD_BOT_TOKEN,
 * DISCORD_API_FAKE): без токена модуль неактивен, API продолжает работать.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DISCORD_API, createDiscordApi } from './discord-api';
import { DiscordController } from './discord.controller';
import { DiscordGateway } from './discord-gateway';
import { DiscordService } from './discord.service';

@Module({
  imports: [AuthModule],
  controllers: [DiscordController],
  providers: [
    DiscordService,
    DiscordGateway,
    { provide: DISCORD_API, useFactory: createDiscordApi },
  ],
  exports: [DiscordService],
})
export class DiscordModule {}
