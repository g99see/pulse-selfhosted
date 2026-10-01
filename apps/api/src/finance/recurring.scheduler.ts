// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Планировщик регулярных платежей (ТЗ §3.2, §9). Тик раз в минуту: в срок
 * создаёт транзакцию через финансовый сервис (баланс счёта меняется там же),
 * за день до списания шлёт напоминание через диспетчер уведомлений.
 *
 * В продакшене тик идёт через BullMQ (ioredis/Valkey); если Valkey недоступен
 * или REDIS_URL не задан — планировщик переходит на таймер в процессе.
 * Идемпотентность: nextRunAt забирается условным updateMany (CAS), поэтому
 * повторный тик и перезапуск не создают дубль; напоминание помечается
 * remindedFor. В тестах автостарт выключен, тесты вызывают runOnce().
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Account, RecurringPayment, User } from '@prisma/client';
import {
  advanceOccurrence,
  formatDateOnly,
  formatMoney,
  isCurrency,
  localDateOf,
} from '@puls/shared';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { NotificationDispatcher } from '../notifications/dispatcher';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleFromRow } from './recurring.service';
import { TransactionsService } from './transactions.service';

export const RECURRING_QUEUE = 'puls-recurring';
export const DEFAULT_RECURRING_TICK_MS = 60_000;
/** Напоминание за 1 день до списания (ТЗ §3.2). */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export interface RecurringRunResult {
  created: number;
  reminders: number;
}

type RecurringWithRelations = RecurringPayment & { user: User; account: Account };

@Injectable()
export class RecurringScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringScheduler.name);
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private readonly tickMs = Number(process.env.RECURRING_TICK_MS ?? DEFAULT_RECURRING_TICK_MS);
  /** В тестах автостарт выключен: тесты сами вызывают runOnce(). */
  private readonly autoStart =
    process.env.NODE_ENV !== 'test' && (process.env.RECURRING_SCHEDULER ?? 'on') !== 'off';

  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private probe: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Планировщик регулярных платежей не стартует автоматически');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Обрабатывает наступившие списания и напоминания за день (идемпотентно). */
  async runOnce(now: Date = new Date()): Promise<RecurringRunResult> {
    if (this.running) return { created: 0, reminders: 0 };
    this.running = true;

    try {
      const payments = await this.prisma.recurringPayment.findMany({
        where: { active: true },
        include: { user: true, account: true },
      });

      let created = 0;
      let reminders = 0;
      for (const payment of payments) {
        const untilDue = payment.nextRunAt.getTime() - now.getTime();
        if (untilDue <= 0) {
          if (await this.createDueTransaction(payment, now)) created += 1;
        } else if (untilDue <= REMINDER_LEAD_MS) {
          if (await this.sendReminder(payment, now)) reminders += 1;
        }
      }

      if (created > 0 || reminders > 0) {
        this.logger.log(`Регулярные платежи: списаний ${created}, напоминаний ${reminders}`);
      }
      return { created, reminders };
    } finally {
      this.running = false;
    }
  }

  /**
   * Создаёт транзакцию за наступившее списание. Сначала условно «забирает»
   * платёж (CAS по nextRunAt) — при повторном тике или перезапуске второй
   * проход не получит прав и дубль не появится.
   */
  private async createDueTransaction(payment: RecurringWithRelations, now: Date): Promise<boolean> {
    const schedule = scheduleFromRow(payment);
    const advanced = advanceOccurrence(schedule, localDateOf(payment.nextRunAt, payment.timezone));

    const claimed = await this.prisma.recurringPayment.updateMany({
      where: { id: payment.id, active: true, nextRunAt: payment.nextRunAt },
      data: { nextRunAt: advanced.instant, lastRunAt: now, remindedFor: null },
    });
    if (claimed.count === 0) return false;

    const dueDate = formatDateOnly(localDateOf(payment.nextRunAt, payment.timezone));
    try {
      await this.transactions.create(payment.userId, {
        accountId: payment.accountId,
        categoryId: payment.categoryId ?? undefined,
        type: payment.type === 'income' ? 'income' : 'expense',
        amount: Number(payment.amount),
        comment: payment.name,
        date: dueDate,
      });
      return true;
    } catch (error) {
      // Разовая ошибка не должна «съесть» платёж — возвращаем расписание.
      await this.prisma.recurringPayment
        .updateMany({
          where: { id: payment.id },
          data: { nextRunAt: payment.nextRunAt, lastRunAt: payment.lastRunAt },
        })
        .catch(() => undefined);
      this.logger.warn(
        `Не удалось создать платёж «${payment.name}»: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return false;
    }
  }

  /** Напоминание за день до списания; повторно не отправляется (remindedFor). */
  private async sendReminder(payment: RecurringWithRelations, now: Date): Promise<boolean> {
    if (payment.remindedFor && payment.remindedFor.getTime() === payment.nextRunAt.getTime()) {
      return false;
    }
    if (!payment.user.notificationsEnabled) return false;

    const rule = await this.prisma.notificationRule.findFirst({
      where: { userId: payment.userId, type: 'payments' },
    });
    if (rule && !rule.enabled) return false;
    const channel = rule?.channel === 'email' ? 'email' : 'web_push';

    const currency = isCurrency(payment.account.currency) ? payment.account.currency : 'RUB';
    try {
      await this.dispatcher.sendRecurringReminder(
        payment.userId,
        { now, email: payment.user.email, timezone: payment.user.timezone, channel },
        {
          name: payment.name,
          amount: formatMoney(Number(payment.amount), currency, 'ru-RU'),
          dueDate: formatDateOnly(localDateOf(payment.nextRunAt, payment.timezone)),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Не удалось отправить напоминание «${payment.name}»: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return false;
    }

    await this.prisma.recurringPayment.updateMany({
      where: { id: payment.id, nextRunAt: payment.nextRunAt },
      data: { remindedFor: payment.nextRunAt },
    });
    return true;
  }

  private async start(): Promise<void> {
    if (this.redisUrl.length === 0) {
      this.logger.warn('REDIS_URL не задан — планировщик работает по таймеру в процессе');
      this.startInterval();
      return;
    }

    try {
      this.probe = new Redis(this.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      this.probe.on('error', () => undefined);
      await this.probe.connect();
      await this.probe.ping();

      this.queue = new Queue(RECURRING_QUEUE, { connection: { url: this.redisUrl } });
      this.worker = new Worker(
        RECURRING_QUEUE,
        async () => {
          await this.runOnce();
        },
        { connection: { url: this.redisUrl } },
      );
      this.worker.on('error', () => undefined);
      this.worker.on('failed', (job, error) => {
        this.logger.warn(`Тик регулярных платежей не прошёл: ${error.message}`);
      });

      await this.queue.upsertJobScheduler(
        'recurring-tick',
        { every: this.tickMs },
        { name: 'tick', data: {} },
      );
      this.logger.log('Планировщик регулярных платежей: BullMQ/Valkey');
    } catch (error) {
      this.logger.warn(
        `Valkey недоступен (${
          error instanceof Error ? error.message : 'unknown'
        }) — планировщик переходит на таймер в процессе`,
      );
      await this.stopQueue();
      this.startInterval();
    }
  }

  private startInterval(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.logger.warn(
          `Ошибка тика планировщика платежей: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
    }, this.tickMs);
    this.timer.unref?.();
  }

  private async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.stopQueue();
  }

  private async stopQueue(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
    if (this.probe) {
      this.probe.disconnect();
      this.probe = null;
    }
  }
}
