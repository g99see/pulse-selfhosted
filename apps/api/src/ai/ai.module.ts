// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../crypto/crypto.module';
import { RolesGuard } from '../moderation/roles.guard';
import { AI_HTTP, FetchAiHttpClient } from './ai-http';
import { AiAdminController } from './ai-admin.controller';
import { AiController } from './ai.controller';
import { AiKeyService } from './ai-key.service';
import { AiProviderService } from './ai-provider.service';

/**
 * AI-помощник по API-ключу (ТЗ §3.9): хранение ключей, адаптеры провайдеров,
 * учёт токенов и админ-настройки. Экспортирует `AiProviderService.complete`
 * для блока B (чат, инструменты, разбор) — тот не знает про ключи.
 */
@Module({
  imports: [AuthModule, CryptoModule],
  controllers: [AiController, AiAdminController],
  providers: [
    AiKeyService,
    AiProviderService,
    { provide: AI_HTTP, useClass: FetchAiHttpClient },
    RolesGuard,
  ],
  exports: [AiProviderService, AiKeyService],
})
export class AiModule {}
