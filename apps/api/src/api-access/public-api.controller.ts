// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CheckInFilterSchema,
  CheckInInputSchema,
  StatsDayQuerySchema,
  TransactionCreateSchema,
  TransactionFilterSchema,
  type CheckInInput,
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
