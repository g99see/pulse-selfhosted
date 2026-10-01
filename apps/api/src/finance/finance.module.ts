// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountsService } from './accounts.service';
import { BudgetsService } from './budgets.service';
import { CategoriesService } from './categories.service';
import { FinanceController } from './finance.controller';
import { TransactionsService } from './transactions.service';

/** Финансовый модуль (ТЗ §3.2): всё под SessionGuard, данные текущего пользователя. */
@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [CategoriesService, AccountsService, TransactionsService, BudgetsService],
  exports: [CategoriesService, AccountsService, TransactionsService, BudgetsService],
})
export class FinanceModule {}
