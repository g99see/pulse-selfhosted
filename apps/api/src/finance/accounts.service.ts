// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma, type Account } from '@prisma/client';
import {
  crossRate,
  type AccountCreateInput,
  type AccountDto,
  type AccountUpdateInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { InternalEvents } from '../common/internal-events';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRatesService } from './rates.service';

/** Дата-ключ «YYYY-MM-DD» для сегодняшнего дня (курс на дату). */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type === 'cash' || account.type === 'savings' ? account.type : 'card',
    balance: Number(account.balance),
    currency: account.currency,
  };
}

/** Счета (ТЗ §3.2): карта, наличные, сбережения — CRUD и общий баланс. */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
  ) {}

  async list(
    userId: string,
  ): Promise<{ accounts: AccountDto[]; totalBalance: number; currency: string }> {
    const [accounts, user] = await Promise.all([
      this.prisma.account.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);

    // Общий баланс — в основной валюте пользователя; валюты счетов
    // пересчитываются по ручным курсам (при отсутствии курса — как есть).
    const needsConversion = accounts.some((account) => account.currency !== user.currency);
    const points = needsConversion ? await this.rates.points(userId) : [];
    const date = todayKey();
    // Суммируем в Decimal: каждый счёт переводится в копейки до сложения, без накопления float.
    const totalBalance = accounts.reduce((sum, account) => {
      const rate =
        account.currency === user.currency
          ? 1
          : (crossRate(points, account.currency, user.currency, user.currency, date) ?? 1);
      return sum.plus(account.balance.times(rate).toDecimalPlaces(2));
    }, new Prisma.Decimal(0));

    return {
      accounts: accounts.map(toAccountDto),
      totalBalance: totalBalance.toDecimalPlaces(2).toNumber(),
      currency: user.currency,
    };
  }

  async create(userId: string, input: AccountCreateInput): Promise<AccountDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const account = await this.prisma.account.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        balance: new Prisma.Decimal(input.balance ?? 0),
        currency: input.currency ?? user.currency,
      },
    });
    InternalEvents.emit('achievement.check', { userId, event: 'account' });
    return toAccountDto(account);
  }

  /** Возвращает счёт пользователя либо 404 (чужой счёт не виден). */
  async resolveOwned(userId: string, accountId: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) {
      throw httpError(404, 'account_not_found', 'Счёт не найден');
    }
    return account;
  }

  async update(userId: string, id: string, input: AccountUpdateInput): Promise<AccountDto> {
    await this.resolveOwned(userId, id);
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.balance !== undefined ? { balance: new Prisma.Decimal(input.balance) } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });
    return toAccountDto(account);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.account.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'account_not_found', 'Счёт не найден');
    }
  }
}
