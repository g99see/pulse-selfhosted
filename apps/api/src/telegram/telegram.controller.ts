// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HTTP-точки Telegram-бота (ТЗ §3.6): вебхук от Telegram и привязка чата из
 * настроек. Вебхук защищён секретным заголовком Telegram, остальные ручки —
 * серверной сессией (SessionGuard) и глобальным CSRF.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { constantTimeEqual } from '../auth/tokens';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { httpError } from '../common/http-error';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  /** Читается в поле: без секрета вебхук не принимается (ТЗ §3.6). */
  private readonly webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

  constructor(private readonly telegram: TelegramService) {}

  /** POST /api/telegram/webhook — приём апдейтов от Telegram. */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    if (!this.telegram.enabled) {
      throw httpError(503, 'telegram_disabled', 'Telegram-бот не настроен');
    }
    if (this.webhookSecret.length === 0) {
      throw httpError(503, 'telegram_webhook_not_configured', 'TELEGRAM_WEBHOOK_SECRET не задан');
    }
    if (typeof secret !== 'string' || !constantTimeEqual(secret, this.webhookSecret)) {
      throw httpError(403, 'invalid_webhook_secret', 'Неверный секрет вебхука');
    }

    await this.telegram.handleUpdate(update);
    return { ok: true };
  }

  /** GET /api/telegram/status — состояние привязки для настроек. */
  @Get('status')
  @UseGuards(SessionGuard)
  status(@Req() req: AuthenticatedRequest) {
    return this.telegram.status(req.user!.id);
  }

  /**
   * POST /api/telegram/connect — одноразовая ссылка-подключение бота (ТЗ §6):
   * deep-link на общего бота Pulse, TTL 10 минут, в БД только хеш токена.
   */
  @Post('connect')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  connect(@Req() req: AuthenticatedRequest) {
    return this.telegram.connectLink(req.user!.id);
  }

  /** DELETE /api/telegram/link — отвязать чат. */
  @Delete('link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async unlink(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.telegram.unlink(req.user!.id);
  }
}
