// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Уведомление о расхождении сверки: после импорта выписки считает отчёт сверки
 * и, если необъяснённая разница не нулевая, зовёт notifyReconciliationMismatch.
 * На одну выписку — одно уведомление: отметка mismatchNotifiedAt в строке
 * выписки, а повторная загрузка того же файла (новая строка с теми же остатком
 * и периодом) наследует отметку и молчит.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { formatMoney, type Currency } from '@puls/shared';
import { InternalEvents, type InternalEventMap } from '../common/internal-events';
import { ReconciliationService } from '../finance/reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from './dispatcher';

@Injectable()
export class ReconciliationAlerts implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationAlerts.name);
  private readonly handler = (payload: InternalEventMap['statement.imported']): void => {
    void this.onStatementImported(payload).catch((error: unknown) => {
      this.logger.warn(
        `Уведомление о сверке не поставлено: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  onModuleInit(): void {
    InternalEvents.on('statement.imported', this.handler);
  }

  onModuleDestroy(): void {
    InternalEvents.off('statement.imported', this.handler);
  }

  /** Возвращает true, если уведомление поставлено в очередь; публично для тестов. */
  async onStatementImported(payload: InternalEventMap['statement.imported']): Promise<boolean> {
    const statement = await this.prisma.accountBankBalance.findFirst({
      where: { id: payload.statementId, userId: payload.userId },
    });
    if (!statement || statement.mismatchNotifiedAt) return false;

    const report = await this.reconciliation.report(payload.userId, payload.accountId);
    if (report.unexplained === null || report.unexplained === 0) return false;

    // Тот же файл загружен повторно: по такой выписке уже предупреждали.
    const twin = await this.prisma.accountBankBalance.findFirst({
      where: {
        accountId: payload.accountId,
        id: { not: statement.id },
        mismatchNotifiedAt: { not: null },
        balance: statement.balance,
        asOf: statement.asOf,
        periodFrom: statement.periodFrom,
        periodTo: statement.periodTo,
      },
    });
    await this.prisma.accountBankBalance.update({
      where: { id: statement.id },
      data: { mismatchNotifiedAt: new Date() },
    });
    if (twin) return false;

    const sign = report.unexplained > 0 ? '+' : '';
    return this.dispatcher.notifyReconciliationMismatch(payload.userId, {
      accountName: report.accountName,
      difference: `${sign}${formatMoney(report.unexplained, report.currency as Currency)}`,
    });
  }
}
