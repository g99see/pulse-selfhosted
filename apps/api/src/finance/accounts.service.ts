// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma, type Account } from '@prisma/client';
import type { AccountCreateInput, AccountDto, AccountUpdateInput } from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<{ accounts: AccountDto[]; totalBalance: number; currency: string }> {
    const [accounts, user] = await Promise.all([
      this.prisma.account.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);

    const totalBalance = accounts.reduce((sum, account) => sum + Number(account.balance), 0);
    return {
      accounts: accounts.map(toAccountDto),
      totalBalance: Math.round(totalBalance * 100) / 100,
      currency: accounts[0]?.currency ?? user.currency,
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
