// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AccountCreateSchema,
  AccountUpdateSchema,
  BudgetUpsertSchema,
  CategoryCreateSchema,
  CategoryUpdateSchema,
  ExchangeRateCreateSchema,
  ExchangeRateFilterSchema,
  ImportCommitRequestSchema,
  ImportPreviewRequestSchema,
  QuickTransactionSchema,
  TransactionCreateSchema,
  TransactionFilterSchema,
  TransferCreateSchema,
  monthKey,
  type AccountCreateInput,
  type AccountUpdateInput,
  type BudgetUpsertInput,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type ExchangeRateCreateInput,
  type ImportCommitRequest,
  type ImportPreviewRequest,
  type TransactionCreateInput,
  type TransferCreateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AccountsService } from './accounts.service';
import { BudgetsService } from './budgets.service';
import { CategoriesService } from './categories.service';
import { ExchangeRatesService } from './rates.service';
import { ImportService } from './import.service';
import { TransactionsService } from './transactions.service';

/** Финансы (ТЗ §3.2): категории, счета, транзакции, переводы и бюджеты. */
@Controller('finance')
@UseGuards(SessionGuard)
export class FinanceController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly accounts: AccountsService,
    private readonly transactions: TransactionsService,
    private readonly budgets: BudgetsService,
    private readonly rates: ExchangeRatesService,
    private readonly imports: ImportService,
  ) {}

  /* ----- Обзор для экрана «Финансы» ----- */

  @Get('overview')
  async overview(@Req() req: AuthenticatedRequest, @Query('month') month?: string) {
    const userId = req.user!.id;
    const targetMonth = month ?? monthKey(new Date());

    const [accounts, categories, transactions, budgets] = await Promise.all([
      this.accounts.list(userId),
      this.categories.list(userId),
      this.transactions.list(userId, { limit: 50 }),
      this.budgets.list(userId, targetMonth),
    ]);

    return {
      accounts: accounts.accounts,
      categories,
      transactions,
      budgets,
      totalBalance: accounts.totalBalance,
      currency: accounts.currency,
      month: targetMonth,
    };
  }

  /* ----- Категории ----- */

  @Get('categories')
  async listCategories(@Req() req: AuthenticatedRequest) {
    return { categories: await this.categories.list(req.user!.id) };
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @Body(new ZodValidationPipe(CategoryCreateSchema)) body: CategoryCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categories.create(req.user!.id, body);
  }

  @Put('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CategoryUpdateSchema)) body: CategoryUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.categories.update(req.user!.id, id, body);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCategory(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.categories.remove(req.user!.id, id);
  }

  /* ----- Счета ----- */

  @Get('accounts')
  listAccounts(@Req() req: AuthenticatedRequest) {
    return this.accounts.list(req.user!.id);
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  createAccount(
    @Body(new ZodValidationPipe(AccountCreateSchema)) body: AccountCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.accounts.create(req.user!.id, body);
  }

  @Put('accounts/:id')
  updateAccount(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AccountUpdateSchema)) body: AccountUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.accounts.update(req.user!.id, id, body);
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAccount(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.accounts.remove(req.user!.id, id);
  }

  /* ----- Транзакции ----- */

  @Get('transactions')
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
  @HttpCode(HttpStatus.CREATED)
  createTransaction(
    @Body(new ZodValidationPipe(TransactionCreateSchema)) body: TransactionCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transactions.create(req.user!.id, body);
  }

  @Post('transactions/quick')
  @HttpCode(HttpStatus.CREATED)
  quickTransaction(
    @Body(new ZodValidationPipe(QuickTransactionSchema)) body: { text: string; accountId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transactions.quick(req.user!.id, body.text, body.accountId);
  }

  @Delete('transactions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTransaction(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.transactions.remove(req.user!.id, id);
  }

  /* ----- Переводы ----- */

  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  createTransfer(
    @Body(new ZodValidationPipe(TransferCreateSchema)) body: TransferCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.transactions.transfer(req.user!.id, body);
  }

  /* ----- Импорт выписки CSV (ТЗ §3.2) ----- */

  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  previewImport(
    @Body(new ZodValidationPipe(ImportPreviewRequestSchema)) body: ImportPreviewRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.preview(req.user!.id, body);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.CREATED)
  commitImport(
    @Body(new ZodValidationPipe(ImportCommitRequestSchema)) body: ImportCommitRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.commit(req.user!.id, body);
  }

  /* ----- Бюджеты ----- */

  @Get('budgets')
  async listBudgets(@Req() req: AuthenticatedRequest, @Query('month') month?: string) {
    const targetMonth = month ?? monthKey(new Date());
    return { budgets: await this.budgets.list(req.user!.id, targetMonth), month: targetMonth };
  }

  @Put('budgets')
  upsertBudget(
    @Body(new ZodValidationPipe(BudgetUpsertSchema)) body: BudgetUpsertInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.budgets.upsert(req.user!.id, body);
  }

  @Put('budgets/:id')
  updateBudget(
    @Param('id') id: string,
    @Body() body: { limit?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const limit = Number(body?.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw httpError(400, 'validation_error', 'Некорректный лимит');
    }
    return this.budgets.update(req.user!.id, id, limit);
  }

  @Delete('budgets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeBudget(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.budgets.remove(req.user!.id, id);
  }

  /* ----- Курсы валют (ТЗ §3.2) ----- */

  @Get('rates')
  async listRates(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const filter = ExchangeRateFilterSchema.safeParse(query);
    if (!filter.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры фильтра курсов');
    }
    return { rates: await this.rates.list(req.user!.id, filter.data) };
  }

  /** Создаёт или обновляет ручной курс на дату (одна единица base = rate quote). */
  @Put('rates')
  upsertRate(
    @Body(new ZodValidationPipe(ExchangeRateCreateSchema)) body: ExchangeRateCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rates.upsert(req.user!.id, body);
  }

  @Delete('rates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRate(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.rates.remove(req.user!.id, id);
  }
}
