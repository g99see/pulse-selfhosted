// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CheckInFilterSchema,
  CheckInInputSchema,
  QuickTransactionPublicSchema,
  StatsDayQuerySchema,
  TransactionCreateSchema,
  TransactionFilterSchema,
  parseQuickTransaction,
  type CheckInInput,
  type QuickTransactionPublicInput,
  type QuickTransactionResponse,
  type TransactionCreateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CheckinsService } from '../checkins/checkins.service';
import { TransactionsService } from '../finance/transactions.service';
import { StatsService } from '../stats/stats.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ApiTokenGuard, RequireApiScopes } from './api-token.guard';

/**
 * Публичный API `/api/v1/*` (ТЗ §4, P2): доступ по личному токену для Home
 * Assistant, n8n и своих скриптов. Данные — только владельца токена; чтение
 * требует области read, запись — write.
 */
@Controller('v1')
@UseGuards(ApiTokenGuard)
export class PublicApiController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly checkins: CheckinsService,
    private readonly stats: StatsService,
  ) {}

  @Get('me')
  @RequireApiScopes('read')
  me(@Req() req: AuthenticatedRequest) {
    const user = req.user!;
    return {
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        currency: user.currency,
        timezone: user.timezone,
        locale: user.locale,
      },
      scopes: req.apiToken?.scopes ?? [],
    };
  }

  @Get('transactions')
  @RequireApiScopes('read')
  async listTransactions(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const filter = TransactionFilterSchema.safeParse(query);
    if (!filter.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры фильтра');
    }
    return { transactions: await this.transactions.list(req.user!.id, filter.data) };
  }

  @Post('transactions')
  @RequireApiScopes('write')
  @HttpCode(HttpStatus.CREATED)
  createTransaction(
    @Body(new ZodValidationPipe(TransactionCreateSchema)) body: TransactionCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transactions.create(req.user!.id, body);
  }

  /**
   * Быстрый ввод траты текстом (ТЗ §4, docs/MONEY-INPUT.md) для iPhone/Shortcuts:
   * отдельная область transactions:quick, идемпотентность по Idempotency-Key.
   * `?format=text` отдаёт короткую фразу для Siri вместо JSON.
   */
  @Post('transactions/quick')
  @RequireApiScopes('transactions:quick')
  @HttpCode(HttpStatus.CREATED)
  async quickTransaction(
    @Body(new ZodValidationPipe(QuickTransactionPublicSchema)) body: QuickTransactionPublicInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Query('format') format: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QuickTransactionResponse | string> {
    const result = await this.transactions.quickPublic(req.user!.id, body, idempotencyKey);
    if (format === 'text') {
      res.type('text/plain; charset=utf-8');
      return quickReceiptText(result, body);
    }
    return result;
  }

  @Get('checkins')
  @RequireApiScopes('read')
  async listCheckins(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const filter = CheckInFilterSchema.safeParse(query);
    if (!filter.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры фильтра');
    }
    return { checkIns: await this.checkins.list(req.user!.id, filter.data) };
  }

  @Post('checkins')
  @RequireApiScopes('write')
  @HttpCode(HttpStatus.CREATED)
  createCheckin(
    @Body(new ZodValidationPipe(CheckInInputSchema)) body: CheckInInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checkins.create(req.user!.id, body);
  }

  @Get('stats/day')
  @RequireApiScopes('read')
  async statsDay(@Req() req: AuthenticatedRequest, @Query('date') date?: string) {
    const parsed = StatsDayQuerySchema.safeParse({ date });
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректная дата');
    }
    return this.stats.day(req.user!.id, parsed.data.date);
  }
}

/** Знаки валют для короткой фразы (Siri читает её вслух). */
const CURRENCY_SIGNS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

/** Сумма без лишних нулей: 250 → «250», 12.5 → «12.50». */
function shortAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/**
 * Короткая фраза подтверждения для `?format=text` (iPhone/Shortcuts): Siri
 * проговаривает её напрямую, без разбора JSON. Пример: «Записал: кофе 250 ₽».
 */
export function quickReceiptText(
  result: QuickTransactionResponse,
  input: QuickTransactionPublicInput,
): string {
  const parsed = parseQuickTransaction(input.text);
  const label = (input.comment ?? parsed?.title ?? input.text).trim();
  const sign = CURRENCY_SIGNS[result.currency] ?? result.currency;
  const prefix = result.duplicate ? 'Уже записано' : 'Записал';
  return `${prefix}: ${label} ${shortAmount(result.amount)} ${sign}`;
}
