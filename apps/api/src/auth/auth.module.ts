// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CryptoModule } from '../crypto/crypto.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [CryptoModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    PasswordService,
    MailService,
    RateLimitService,
    TwoFactorService,
    SessionGuard,
    // CSRF проверяется глобально для всех мутирующих запросов (ТЗ §6).
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [AuthService, SessionService, MailService, PasswordService, SessionGuard, RateLimitService, TwoFactorService],
})
export class AuthModule {}
