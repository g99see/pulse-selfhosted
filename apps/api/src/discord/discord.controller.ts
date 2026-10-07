// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HTTP-точки Discord-канала (ТЗ §6): состояние, ссылка-подключение одним
 * нажатием, OAuth-возврат и отвязка. callback — обычный GET (безопасный метод,
 * CSRF не применяется): подлинность защищена одноразовым state-токеном.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { DiscordService } from './discord.service';

@Controller('discord')
export class DiscordController {
  constructor(private readonly discord: DiscordService) {}

  @Get('status')
  @UseGuards(SessionGuard)
  status(@Req() req: AuthenticatedRequest) {
    return this.discord.status(req.user!.id);
  }

  /**
   * POST /api/discord/connect — одноразовая ссылка-подключение (ТЗ §6):
   * OAuth-ссылка с токеном в state, TTL 10 минут, в БД только хеш.
   */
  @Post('connect')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  connect(@Req() req: AuthenticatedRequest) {
    return this.discord.connectLink(req.user!.id);
  }

  /**
   * GET /api/discord/callback?code=…&state=… — возврат от Discord: сервис
   * завершает привязку, а мы отправляем пользователя обратно в настройки.
   */
  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ url: string; statusCode: number }> {
    const result = await this.discord.completeOAuth(code ?? '', state ?? '');
    const base = (process.env.WEB_APP_URL ?? '').replace(/\/+$/, '');
    const target = result.ok
      ? `${base}/settings?discord=connected`
      : `${base}/settings?discord=error&reason=${encodeURIComponent(result.reason ?? 'invalid')}`;
    return { url: target, statusCode: 302 };
  }

  @Delete('link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async unlink(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.discord.unlink(req.user!.id);
  }
}
