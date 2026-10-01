// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Регулярные платежи (ТЗ §3.2): CRUD, пауза/возобновление и ближайшие списания.
 * Всё изолировано по userId, суммы — Decimal. Расчёт следующей даты — чистая
 * логика @puls/shared; здесь только БД, проверки прав и связь со счетами.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_RECURRING_TIME,
  advanceOccurrence,
  formatDateOnly,
  formatMoney,
  isCurrency,
  localDateOf,
  nextOccurrence,
  ruleError,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type RecurringPaymentCreateInput,
  type RecurringPaymentDto,
  type RecurringPaymentUpdateInput,
  type RecurringSchedule,
  type RecurringUpcomingItem,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';

const withRelations = { account: true, category: true } satisfies Prisma.RecurringPaymentInclude;
type RecurringRow = Prisma.RecurringPaymentGetPayload<{ include: typeof withRelations }>;

const FREQUENCIES: readonly RecurrenceFrequency[] = ['weekly', 'monthly', 'yearly'];

/** Правило периодичности из строки БД. */
export function ruleFromRow(row: {
  frequency: string;
  scheduleDay: number;
  scheduleMonth: number | null;
}): RecurrenceRule {
  const frequency = FREQUENCIES.find((value) => value === row.frequency) ?? 'monthly';
  return { frequency, day: row.scheduleDay, month: row.scheduleMonth ?? undefined };
}

/** Расписание (правило + время + зона) из строки БД. */
export function scheduleFromRow(row: {
  frequency: string;
  scheduleDay: number;
  scheduleMonth: number | null;
  timeOfDay: string;
  timezone: string;
}): RecurringSchedule {
  return {
    rule: ruleFromRow(row),
    timeOfDay: row.timeOfDay,
    timezone: row.timezone || 'UTC',
  };
}

function frequencyOf(value: string): RecurrenceFrequency {
  return FREQUENCIES.find((item) => item === value) ?? 'monthly';
}

export function toRecurringDto(row: RecurringRow): RecurringPaymentDto {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    type: row.type === 'income' ? 'income' : 'expense',
    currency: row.account.currency,
    accountId: row.accountId,
    accountName: row.account.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    categoryIcon: row.category?.icon ?? null,
    categoryColor: row.category?.color ?? null,
    frequency: frequencyOf(row.frequency),
    day: row.scheduleDay,
    month: row.scheduleMonth,
    timeOfDay: row.timeOfDay,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt.toISOString(),
    active: row.active,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Регулярные платежи (ТЗ §3.2): аренда, подписки и другие списания по расписанию. */
@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
  ) {}

  async list(userId: string): Promise<RecurringPaymentDto[]> {
    const rows = await this.prisma.recurringPayment.findMany({
      where: { userId },
      include: withRelations,
      orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }],
    });
    return rows.map(toRecurringDto);
  }

  /** Ближайшие списания по активным платежам (ТЗ §3.2: список на экране). */
  async upcoming(userId: string, limit = 10): Promise<RecurringUpcomingItem[]> {
    const rows = await this.prisma.recurringPayment.findMany({
      where: { userId, active: true },
      include: { account: true },
      orderBy: { nextRunAt: 'asc' },
      take: 50,
    });

    const now = new Date();
    const items: RecurringUpcomingItem[] = [];
    for (const row of rows) {
      const schedule = scheduleFromRow(row);
      const due = row.nextRunAt.getTime() <= now.getTime();
      const occurrence = due
        ? advanceOccurrence(schedule, localDateOf(row.nextRunAt, row.timezone))
        : { date: localDateOf(row.nextRunAt, row.timezone), instant: row.nextRunAt };
      const currency = isCurrency(row.account.currency) ? row.account.currency : 'RUB';

      items.push({
        paymentId: row.id,
        name: row.name,
        amount: Number(row.amount),
        currency,
        type: row.type === 'income' ? 'income' : 'expense',
        date: formatDateOnly(occurrence.date),
        amountLabel: formatMoney(Number(row.amount), currency, 'ru-RU'),
      });
      if (items.length >= limit) break;
    }
    return items;
  }

  async create(userId: string, input: RecurringPaymentCreateInput): Promise<RecurringPaymentDto> {
    const account = await this.accounts.resolveOwned(userId, input.accountId);
    if (input.categoryId) {
      await this.categories.resolveOwned(userId, input.categoryId);
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const timezone = input.timezone ?? user.timezone ?? 'UTC';
    const rule: RecurrenceRule = { frequency: input.frequency, day: input.day, month: input.month };
    const error = ruleError(rule);
    if (error) throw httpError(400, 'validation_error', error);

    const schedule: RecurringSchedule = {
      rule,
      timeOfDay: input.timeOfDay ?? DEFAULT_RECURRING_TIME,
      timezone,
    };
    const next = nextOccurrence(schedule, new Date());

    const row = await this.prisma.recurringPayment.create({
      data: {
        userId,
        name: input.name,
        amount: new Prisma.Decimal(input.amount),
        type: input.type,
        accountId: account.id,
        categoryId: input.categoryId ?? null,
        frequency: rule.frequency,
        scheduleDay: rule.day,
        scheduleMonth: rule.month ?? null,
        timeOfDay: schedule.timeOfDay,
        timezone,
        nextRunAt: next.instant,
        active: input.active,
      },
      include: withRelations,
    });
    return toRecurringDto(row);
  }

  async update(
    userId: string,
    id: string,
    input: RecurringPaymentUpdateInput,
  ): Promise<RecurringPaymentDto> {
    const existing = await this.findOwn(userId, id);
    if (input.accountId) await this.accounts.resolveOwned(userId, input.accountId);
    if (input.categoryId) await this.categories.resolveOwned(userId, input.categoryId);

    const rule: RecurrenceRule = {
      frequency: input.frequency ?? frequencyOf(existing.frequency),
      day: input.day ?? existing.scheduleDay,
      month: input.month !== undefined ? input.month : (existing.scheduleMonth ?? undefined),
    };
    const error = ruleError(rule);
    if (error) throw httpError(400, 'validation_error', error);

    const timeOfDay = input.timeOfDay ?? existing.timeOfDay;
    const timezone = input.timezone ?? existing.timezone;
    // Пересчёт от «сейчас»: расписание могло измениться, а пауза — снять просрочку.
    const next = nextOccurrence({ rule, timeOfDay, timezone }, new Date());

    const row = await this.prisma.recurringPayment.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        frequency: rule.frequency,
        scheduleDay: rule.day,
        scheduleMonth: rule.month ?? null,
        timeOfDay,
        timezone,
        nextRunAt: next.instant,
        active: input.active ?? existing.active,
        // Расписание изменилось — напоминание об этом списании сбрасываем.
        remindedFor: null,
      },
      include: withRelations,
    });
    return toRecurringDto(row);
  }

  /** Пауза или возобновление платежа (ТЗ §3.2). */
  async setActive(
    userId: string,
    id: string,
    active: boolean,
  ): Promise<RecurringPaymentDto> {
    return this.update(userId, id, { active });
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.recurringPayment.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'recurring_not_found', 'Регулярный платёж не найден');
    }
  }

  private async findOwn(userId: string, id: string) {
    const row = await this.prisma.recurringPayment.findFirst({ where: { id, userId } });
    if (!row) {
      throw httpError(404, 'recurring_not_found', 'Регулярный платёж не найден');
    }
    return row;
  }
}
