// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { ExternalAuthController } from './external-auth.controller';
import { ExternalAuthService } from './external-auth.service';
import { GOOGLE_OAUTH_GATEWAY, GoogleOAuthClient } from './google.gateway';
import { OAuthStateService } from './oauth-state.service';

/**
 * Модуль внешнего входа (ТЗ §3.1, §7): Google и Telegram. Импортирует AuthModule
 * ради SessionService и SessionGuard; HTTP-шлюз Google за токеном, чтобы в
 * тестах подменяться фейком без реальных запросов к Google.
 */
@Module({
  imports: [AuthModule],
  controllers: [ExternalAuthController],
  providers: [
    ExternalAuthService,
    OAuthStateService,
    { provide: GOOGLE_OAUTH_GATEWAY, useClass: GoogleOAuthClient },
  ],
  exports: [ExternalAuthService, OAuthStateService, GOOGLE_OAUTH_GATEWAY],
})
export class ExternalAuthModule {}
