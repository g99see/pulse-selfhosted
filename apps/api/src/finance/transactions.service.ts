// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  guessCategoryName,
  parseQuickTransaction,
  type TransactionCreateInput,
  type TransactionDto,
  type TransactionFilter,
  type TransferCreateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';

const withRelations = { account: true, category: true } satisfies Prisma.TransactionInclude;
type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof withRelations }>;

export function toTransactionDto(transaction: TransactionWithRelations): TransactionDto {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    accountName: transaction.account.name,
    categoryId: transaction.categoryId,
    categoryName: transaction.category?.name ?? null,
    categoryIcon: transaction.category?.icon ?? null,
    categoryColor: transaction.category?.color ?? null,
    type:
      transaction.type === 'income' || transaction.type === 'transfer' ? transaction.type : 'expense',
    amount: Number(transaction.amount),
    currency: transaction.currency,
    date: transaction.date.toISOString(),
    comment: transaction.comment,
    transferAccountId: transaction.transferAccountId,
    createdAt: transaction.createdAt.toISOString(),
  };
}

/** Приводит дату к UTC-полуночи (колонка @db.Date), по умолчанию — сегодня. */
export function toDateOnly(value?: string): Date {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }
  const parsed = new Date(value);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

/** Транзакции и переводы (ТЗ §3.2): баланс счёта меняется в одной транзакции с записью. */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
  ) {}

  async list(userId: string, filter: TransactionFilter): Promise<TransactionDto[]> {
    const where: Prisma.TransactionWhereInput = { userId };
    if (filter.accountId) where.accountId = filter.accountId;
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.type) where.type = filter.type;
    if (filter.from || filter.to) {
      where.date = {
        ...(filter.from ? { gte: toDateOnly(filter.from) } : {}),
        ...(filter.to ? { lte: toDateOnly(filter.to) } : {}),
      };
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      include: withRelations,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit,
    });

    return transactions.map(toTransactionDto);
  }

  async create(userId: string, input: TransactionCreateInput): Promise<TransactionDto> {
    const account = await this.accounts.resolveOwned(userId, input.accountId);
    if (input.categoryId) {
      await this.categories.resolveOwned(userId, input.categoryId);
    }

    const amount = new Prisma.Decimal(input.amount);
    const delta = input.type === 'income' ? amount : amount.negated();

    const transaction = await this.prisma.$transaction(async (db) => {
      const created = await db.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: input.categoryId ?? null,
          type: input.type,
          amount,
          currency: account.currency,
          date: toDateOnly(input.date),
          comment: input.comment ?? null,
        },
        include: withRelations,
      });

      await db.account.update({
        where: { id: account.id },
        data: { balance: { increment: delta } },
      });

      return created;
    });

    return toTransactionDto(transaction);
  }

  /** Быстрый ввод текстом (ТЗ §4): «обед 450» → «Еда», «зарплата +80000» → «Зарплата». */
  async quick(userId: string, text: string, accountId?: string): Promise<TransactionDto> {
    const parsed = parseQuickTransaction(text);
    if (!parsed) {
      throw httpError(400, 'validation_error', 'Не удалось разобрать сумму и описание');
    }

    let targetAccountId = accountId;
    if (targetAccountId) {
      await this.accounts.resolveOwned(userId, targetAccountId);
    } else {
      const first = await this.prisma.account.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
      if (!first) {
        throw httpError(400, 'no_account', 'Сначала создайте счёт');
      }
      targetAccountId = first.id;
    }

    const guess = guessCategoryName(parsed.title);
    let categoryId: string | undefined;
    if (guess) {
      const category = await this.prisma.category.findFirst({
        where: { name: guess, OR: [{ userId }, { userId: null }] },
        orderBy: { isSystem: 'desc' },
      });
      categoryId = category?.id;
    }

    return this.create(userId, {
      accountId: targetAccountId,
      categoryId,
      type: parsed.type,
      amount: parsed.amount,
      comment: parsed.title,
    });
  }

  /** Перевод между счетами (ТЗ §3.2) — не считается расходом. */
  async transfer(userId: string, input: TransferCreateInput): Promise<TransactionDto> {
    const from = await this.accounts.resolveOwned(userId, input.fromAccountId);
    const to = await this.accounts.resolveOwned(userId, input.toAccountId);
    const amount = new Prisma.Decimal(input.amount);

    const transaction = await this.prisma.$transaction(async (db) => {
      const created = await db.transaction.create({
        data: {
          userId,
          accountId: from.id,
          transferAccountId: to.id,
          type: 'transfer',
          amount,
          currency: from.currency,
          date: toDateOnly(input.date),
          comment: input.comment ?? null,
        },
        include: withRelations,
      });

      await db.account.update({ where: { id: from.id }, data: { balance: { decrement: amount } } });
      await db.account.update({ where: { id: to.id }, data: { balance: { increment: amount } } });

      return created;
    });

    return toTransactionDto(transaction);
  }

  async remove(userId: string, id: string): Promise<void> {
    const transaction = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!transaction) {
      throw httpError(404, 'transaction_not_found', 'Транзакция не найдена');
    }

    await this.prisma.$transaction(async (db) => {
      if (transaction.type === 'transfer') {
        await db.account.update({
          where: { id: transaction.accountId },
          data: { balance: { increment: transaction.amount } },
        });
        if (transaction.transferAccountId) {
          await db.account.update({
            where: { id: transaction.transferAccountId },
            data: { balance: { decrement: transaction.amount } },
          });
        }
      } else {
        const delta = transaction.type === 'income' ? transaction.amount.negated() : transaction.amount;
        await db.account.update({
          where: { id: transaction.accountId },
          data: { balance: { increment: delta } },
        });
      }

      await db.transaction.delete({ where: { id: transaction.id } });
    });
  }
}
