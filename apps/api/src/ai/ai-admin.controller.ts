// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Get, Put, Post, Query, UseGuards } from '@nestjs/common';
import { AiInstanceSettingsSchema, type AiInstanceSettingsInput } from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Roles } from '../moderation/roles.decorator';
import { RolesGuard } from '../moderation/roles.guard';
import { AiKeyService, usageMonth } from './ai-key.service';
import { AiProviderService } from './ai-provider.service';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Админка AI экземпляра (ТЗ §2, §3.9): общий ключ, провайдер, модель и лимит
 * токенов на пользователя в месяц. Только роль admin. Ключ наружу не отдаётся —
 * видны последние 4 символа.
 */
@Controller('admin/ai')
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
export class AiAdminController {
  constructor(
    private readonly keys: AiKeyService,
    private readonly provider: AiProviderService,
  ) {}

  /** Текущие настройки AI экземпляра. */
  @Get('settings')
  async getSettings() {
    return { settings: await this.keys.getInstanceSettings() };
  }

  /** Частичное обновление настроек: пустое поле не меняется, null очищает. */
  @Put('settings')
  async setSettings(@Body(new ZodValidationPipe(AiInstanceSettingsSchema)) body: AiInstanceSettingsInput) {
    await this.keys.setInstanceSettings(body);
    return { settings: await this.keys.getInstanceSettings() };
  }

  /** Проверка настроек до сохранения (новый ключ может быть ещё не сохранён). */
  @Post('settings/test')
  testSettings(@Body(new ZodValidationPipe(AiInstanceSettingsSchema)) body: AiInstanceSettingsInput) {
    return this.provider.testInstanceSettings(body);
  }

  /** Расход токенов по пользователям за месяц; по умолчанию текущий. */
  @Get('usage')
  async usage(@Query('month') month?: string) {
    const value = month && month.length > 0 ? month : usageMonth();
    if (!MONTH_PATTERN.test(value)) {
      throw httpError(400, 'validation_error', 'Месяц в формате YYYY-MM');
    }
    return this.keys.adminUsage(value);
  }
}
