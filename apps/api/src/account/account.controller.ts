// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DeleteAccountSchema, ExportQuerySchema, type DeleteAccountInput } from '@puls/shared';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clearCookieOptions, CSRF_COOKIE, SESSION_COOKIE } from '../auth/cookies';
import { RateLimitService } from '../auth/rate-limit.service';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AccountService, EXPORT_LIMIT, RATE_WINDOW_SECONDS } from './account.service';
import { contentDisposition, DataExportService, exportFilename } from './data-export.service';

/**
 * Экспорт и удаление аккаунта (ТЗ §3.1, §6, §9). Всё под серверной сессией;
 * DELETE дополнительно защищён глобальным CsrfGuard.
 */
@Controller('account')
@UseGuards(SessionGuard)
export class AccountController {
  constructor(
    private readonly exporter: DataExportService,
    private readonly account: AccountService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** GET /api/account/export?format=json|csv — полная выгрузка своих данных. */
  @Get('export')
  async export(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query() query: Record<string, unknown>,
  ): Promise<void> {
    const parsed = ExportQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректный формат выгрузки', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    const user = req.user!;
    const limit = await this.rateLimit.consume(
      `account:export:${user.id}`,
      EXPORT_LIMIT,
      RATE_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw httpError(429, 'rate_limited', 'Слишком много выгрузок. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (parsed.data.format === 'csv') {
      const archive = await this.exporter.exportZip(user.id);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', contentDisposition(exportFilename(user.nickname, 'zip')));
      res.send(archive);
      return;
    }

    const document = await this.exporter.exportJson(user.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(exportFilename(user.nickname, 'json')));
    res.send(Buffer.from(JSON.stringify(document, null, 2), 'utf8'));
  }

  /** DELETE /api/account — полное удаление с подтверждением паролем и ником. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(DeleteAccountSchema)) body: DeleteAccountInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.deleteAccount(req.user!.id, body, { ip: req.ip });

    // Сессии уже удалены вместе с пользователем — гасим cookie.
    res.clearCookie(SESSION_COOKIE, clearCookieOptions());
    res.clearCookie(CSRF_COOKIE, clearCookieOptions());
  }
}
