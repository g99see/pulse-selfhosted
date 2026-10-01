// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AiKeySetSchema, type AiKeySetInput } from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AiKeyService } from './ai-key.service';
import { AiProviderService } from './ai-provider.service';

/**
 * Личные настройки AI-помощника (ТЗ §3.9): состояние, подключение/смена личного
 * ключа, отключение и «Проверить подключение». Ключ наружу не отдаётся — только
 * последние 4 символа внутри status.
 */
@Controller('ai')
@UseGuards(SessionGuard)
export class AiController {
  constructor(
    private readonly keys: AiKeyService,
    private readonly provider: AiProviderService,
  ) {}

  /** Состояние AI: включён ли, чей ключ, модель и расход за месяц. */
  @Get('status')
  async status(@Req() req: AuthenticatedRequest) {
    return { status: await this.keys.status(req.user!.id) };
  }

  /** Подключение/смена личного ключа (приоритетнее общего ключа экземпляра). */
  @Put('key')
  async setKey(
    @Body(new ZodValidationPipe(AiKeySetSchema)) body: AiKeySetInput,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.keys.setUserKey(req.user!.id, body);
    return { status: await this.keys.status(req.user!.id) };
  }

  /** Удаление личного ключа: пользователь возвращается к общему ключу экземпляра (204). */
  @Delete('key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearKey(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.keys.clearUserKey(req.user!.id);
  }

  /** Проверка подключения текущим ключом (личным или общим). */
  @Post('key/test')
  test(@Req() req: AuthenticatedRequest) {
    return this.provider.testConnection(req.user!.id);
  }
}
