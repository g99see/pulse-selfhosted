// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CLAMAV_SCANNER, createClamAvScanner } from './clamav';
import { HtmlPageController } from './html-page.controller';
import { HtmlPageService } from './html-page.service';
import { SandboxController } from './sandbox.controller';

/**
 * HTML-страница профиля (ТЗ §3.8): хранение версий, автопроверка, антивирус и
 * публичная отдача с отдельного домена. Сканер собирается по CLAMAV_HOST —
 * без него работает noop-заглушка с понятным логом.
 */
@Module({
  imports: [AuthModule],
  controllers: [HtmlPageController, SandboxController],
  providers: [
    HtmlPageService,
    { provide: CLAMAV_SCANNER, useFactory: () => createClamAvScanner(process.env.CLAMAV_HOST) },
  ],
  exports: [HtmlPageService],
})
export class HtmlPageModule {}
