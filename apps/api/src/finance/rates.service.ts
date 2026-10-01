// SPDX-License-Identifier: AGPL-3.0-or-later
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ExchangeRate } from '@prisma/client';
import {
  crossRate,
  roundRate,
  type Currency,
  type ExchangeRateCreateInput,
  type ExchangeRateDto,
  type ExchangeRateFilter,
  type RatePoint,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { RATES_PROVIDER, type RatesProvider } from './rates-provider';

/** Дата-колонка @db.Date: UTC-полночь дня «YYYY-MM-DD». */
export function rateDateOnly(value: string): Date {
  const parsed = new Date(value);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

/** Ключ дня из значения @db.Date. */
function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toExchangeRateDto(rate: ExchangeRate): ExchangeRateDto {
  return {
    id: rate.id,
    date: dayKeyOf(rate.date),
    base: rate.base,
    quote: rate.quote,
    rate: Number(rate.rate),
    source: rate.source,
  };
}

/**
 * Курсы валют (ТЗ §3.2): ручной CRUD под текущим пользователем и подбор курса
 * на дату. Ручные курсы приоритетны; при RATES_PROVIDER=frankfurter недостающий
 * курс подтягивается с публичного API и кешируется. Каждый запрос изолирован
 * по user_id.
 */
@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RATES_PROVIDER) private readonly provider: RatesProvider | null,
  ) {}

  async list(userId: string, filter: ExchangeRateFilter = {}): Promise<ExchangeRateDto[]> {
    const where: Prisma.ExchangeRateWhereInput = { userId };
    if (filter.date) where.date = rateDateOnly(filter.date);
    if (filter.base) where.base = filter.base;
    if (filter.quote) where.quote = filter.quote;

    const rates = await this.prisma.exchangeRate.findMany({
      where,
      orderBy: [{ date: 'desc' }, { base: 'asc' }, { quote: 'asc' }],
      take: 500,
    });
    return rates.map(toExchangeRateDto);
  }

  /** Создаёт или обновляет ручной курс по ключу (пользователь, дата, base, quote). */
  async upsert(userId: string, input: ExchangeRateCreateInput): Promise<ExchangeRateDto> {
    const date = rateDateOnly(input.date);
    const value = new Prisma.Decimal(roundRate(input.rate));

    const rate = await this.prisma.exchangeRate.upsert({
      where: { userId_date_base_quote: { userId, date, base: input.base, quote: input.quote } },
      update: { rate: value, source: input.source },
      create: {
        userId,
        date,
        base: input.base,
        quote: input.quote,
        rate: value,
        source: input.source,
      },
    });
    return toExchangeRateDto(rate);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.exchangeRate.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'rate_not_found', 'Курс не найден');
    }
  }

  /** Все курсы пользователя как точки для чистых функций @puls/shared. */
  async points(userId: string): Promise<RatePoint[]> {
    const rates = await this.prisma.exchangeRate.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
    });
    return rates.map((rate) => ({
      date: dayKeyOf(rate.date),
      base: rate.base,
      quote: rate.quote,
      rate: Number(rate.rate),
    }));
  }

  /**
   * Курс from→to на дату: сначала ручные курсы пользователя (ближайший на дату
   * или последний предыдущий, кросс — через основную валюту), затем опционально
   * публичный источник. Нет курсa — 400 rate_not_found.
   */
  async resolveRate(userId: string, from: Currency, to: Currency, date: string): Promise<number> {
    if (from === to) return 1;

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const points = await this.points(userId);
    const manual = crossRate(points, from, to, user.currency, date);
    if (manual !== null) return roundRate(manual);

    if (this.provider) {
      const fetched = await this.provider.fetchRate(from, to, date);
      if (fetched !== null && fetched > 0) {
        await this.upsert(userId, {
          date,
          base: from,
          quote: to,
          rate: fetched,
          source: 'provider',
        });
        return roundRate(fetched);
      }
    }

    throw httpError(400, 'rate_not_found', `Не задан курс ${from}→${to} на ${date}`);
  }
}
