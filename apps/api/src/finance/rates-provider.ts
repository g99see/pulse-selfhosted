// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Источник курсов валют (ТЗ §3.2): self-hosted по умолчанию — курсы вводятся
 * вручную через /api/finance/rates. Опционально курсы подтягиваются с
 * бесплатного публичного API без ключа (frankfurter.dev / ECB) при
 * RATES_PROVIDER=frankfurter. Сетевой клиент спрятан за интерфейсом, поэтому в
 * автотестах используется фейк и реальных запросов не делается.
 */
import { Logger } from '@nestjs/common';

export const RATES_PROVIDER = Symbol('RATES_PROVIDER');

/** Источник курсов: возвращает «сколько quote за 1 base» на дату или null. */
export interface RatesProvider {
  readonly name: string;
  fetchRate(base: string, quote: string, date: string): Promise<number | null>;
}

/** Минимальный контракт fetch, чтобы подменять его в тестах. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface FrankfurterResponse {
  rates?: Record<string, number>;
}

/** Клиент frankfurter.dev (данные ECB), без API-ключа. */
export class FrankfurterRatesProvider implements RatesProvider {
  readonly name = 'frankfurter';
  private readonly logger = new Logger(FrankfurterRatesProvider.name);

  constructor(
    private readonly baseUrl: string = 'https://api.frankfurter.dev/v1',
    private readonly fetchImpl: FetchLike = (url) => fetch(url),
  ) {}

  async fetchRate(base: string, quote: string, date: string): Promise<number | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/${date}?base=${base}&symbols=${quote}`;
    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) return null;
      const body = (await response.json()) as FrankfurterResponse;
      const rate = body.rates?.[quote];
      return typeof rate === 'number' && rate > 0 ? rate : null;
    } catch (error) {
      this.logger.warn(`Не удалось получить курс ${base}→${quote}: ${String(error)}`);
      return null;
    }
  }
}

/**
 * Провайдер курсов по окружению: без RATES_PROVIDER — null (только ручные
 * курсы), RATES_PROVIDER=frankfurter — публичный API ECB.
 */
export function createRatesProvider(env: NodeJS.ProcessEnv = process.env): RatesProvider | null {
  if (env.RATES_PROVIDER === 'frankfurter') {
    return new FrankfurterRatesProvider(env.RATES_API_URL ?? 'https://api.frankfurter.dev/v1');
  }
  return null;
}
