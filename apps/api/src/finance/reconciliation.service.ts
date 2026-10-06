// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  analyzeStatement,
  fromCents,
  matchStatement,
  toCents,
  type BankBalanceInput,
  type PulseOperation,
  type ReconciliationItem,
  type ReconciliationResponse,
  type StatementRow,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { dayKeyOf, toDateOnly } from './transactions.service';

/** Влияние операции на баланс счёта (Decimal): доход +, расход −, перевод — со стороны счёта. */
function effectOn(
  accountId: string,
  tx: {
    type: string;
    amount: Prisma.Decimal;
    toAmount: Prisma.Decimal | null;
    accountId: string;
    transferAccountId: string | null;
  },
): Prisma.Decimal {
  if (tx.type === 'income') return tx.amount;
  if (tx.type === 'expense') return tx.amount.negated();
  if (tx.accountId === accountId) return tx.amount.negated();
  return tx.toAmount ?? tx.amount;
}

/**
 * Сверка счёта с банком: баланс Пульса против баланса по банку (закрывающий остаток
 * последней выписки либо введённый вручную) и список операций, объясняющих разницу.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  /** Вводит баланс карты по банку вручную (с датой). */
  async setManualBalance(userId: string, accountId: string, input: BankBalanceInput) {
    await this.accounts.resolveOwned(userId, accountId);
    await this.prisma.accountBankBalance.create({
      data: {
        userId,
        accountId,
        source: 'manual',
        balance: new Prisma.Decimal(input.balance),
        asOf: toDateOnly(input.date),
      },
    });
    return this.report(userId, accountId);
  }

  async report(userId: string, accountId: string): Promise<ReconciliationResponse> {
    const account = await this.accounts.resolveOwned(userId, accountId);
    const bank = await this.prisma.accountBankBalance.findFirst({
      where: { accountId, userId },
      orderBy: { createdAt: 'desc' },
    });

    const base: ReconciliationResponse = {
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      pulseBalance: Number(account.balance),
      pulseBalanceAsOf: null,
      bankBalance: null,
      bankSource: null,
      bankAsOf: null,
      difference: null,
      explained: null,
      unexplained: null,
      afterBank: { count: 0, net: 0 },
      period: null,
      statementRows: 0,
      items: [],
    };
    if (!bank) return base;

    const asOf = dayKeyOf(bank.asOf);
    const involved = await this.prisma.transaction.findMany({
      where: { userId, OR: [{ accountId }, { transferAccountId: accountId }] },
      select: {
        id: true,
        type: true,
        amount: true,
        toAmount: true,
        accountId: true,
        transferAccountId: true,
        date: true,
        comment: true,
        externalId: true,
        importHash: true,
      },
    });

    // Баланс Пульса на дату банка: текущий минус операции позже этой даты.
    let after = new Prisma.Decimal(0);
    let afterCount = 0;
    const ops: PulseOperation[] = [];
    const periodFrom = bank.periodFrom ? dayKeyOf(bank.periodFrom) : null;
    const periodTo = bank.periodTo ? dayKeyOf(bank.periodTo) : null;
    for (const tx of involved) {
      const effect = effectOn(accountId, tx);
      const day = dayKeyOf(tx.date);
      if (day > asOf) {
        after = after.plus(effect);
        afterCount += 1;
        continue;
      }
      if (periodFrom && periodTo && day >= periodFrom && day <= periodTo) {
        ops.push({
          id: tx.id,
          externalId: tx.externalId,
          date: day,
          amountCents: toCents(Number(effect)),
          description: tx.comment ?? '',
          manual: tx.importHash === null,
        });
      }
    }
    const pulseAsOf = account.balance.minus(after);
    const bankBalance = Number(bank.balance);
    const differenceCents = toCents(Number(pulseAsOf)) - toCents(bankBalance);

    const items: ReconciliationItem[] = [];
    let explainedCents = 0;
    let statementRows = 0;

    if (bank.source === 'statement' && Array.isArray(bank.rows)) {
      const rows = bank.rows as unknown as StatementRow[];
      statementRows = rows.length;
      const analysis = analyzeStatement(rows);
      const { missingInPulse, extraInPulse } = matchStatement(analysis.ordered, ops);

      for (const brk of analysis.breaks) {
        items.push({
          kind: 'chain_break',
          date: brk.row.date,
          time: brk.row.time,
          amount: fromCents(brk.row.amountCents),
          description: brk.row.description,
          externalId: brk.row.externalId,
          transactionId: null,
          manual: false,
          expectedBalance: fromCents(brk.expectedCents),
          actualBalance: fromCents(brk.actualCents),
        });
      }
      for (const row of missingInPulse) {
        explainedCents -= row.amountCents;
        items.push({
          kind: 'missing_in_pulse',
          date: row.date,
          time: row.time,
          amount: fromCents(row.amountCents),
          description: row.description,
          externalId: row.externalId,
          transactionId: null,
          manual: false,
          expectedBalance: null,
          actualBalance: null,
        });
      }
      for (const op of extraInPulse) {
        explainedCents += op.amountCents;
        items.push({
          kind: 'extra_in_pulse',
          date: op.date,
          time: null,
          amount: fromCents(op.amountCents),
          description: op.description,
          externalId: op.externalId,
          transactionId: op.id,
          manual: op.manual,
          expectedBalance: null,
          actualBalance: null,
        });
      }
    }

    return {
      ...base,
      pulseBalanceAsOf: Number(pulseAsOf),
      bankBalance,
      bankSource: bank.source === 'manual' ? 'manual' : 'statement',
      bankAsOf: asOf,
      difference: fromCents(differenceCents),
      explained: fromCents(explainedCents),
      unexplained: fromCents(differenceCents - explainedCents),
      afterBank: { count: afterCount, net: Number(after) },
      period: periodFrom && periodTo ? { from: periodFrom, to: periodTo } : null,
      statementRows,
      items,
    };
  }
}
