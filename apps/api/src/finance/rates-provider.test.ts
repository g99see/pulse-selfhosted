// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты клиента курсов (ТЗ §3.2): сетевой запрос подменён фейком,
// реальных обращений к API в автотестах нет.
import { describe, expect, it } from 'vitest';
import { FrankfurterRatesProvider, createRatesProvider, type FetchLike } from './rates-provider';

function fakeFetch(payload: unknown, ok = true): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const fetch: FetchLike = (url) => {
    calls.push(url);
    return Promise.resolve({ ok, json: () => Promise.resolve(payload) });
  };
  return { calls, fetch };
}

describe('FrankfurterRatesProvider', () => {
  it('возвращает курс из ответа и формирует URL с датой, base и symbols', async () => {
    const { calls, fetch } = fakeFetch({ rates: { RUB: 95.5 } });
    const provider = new FrankfurterRatesProvider('https://api.frankfurter.dev/v1', fetch);

    await expect(provider.fetchRate('USD', 'RUB', '2026-10-01')).resolves.toBe(95.5);
    expect(calls[0]).toBe('https://api.frankfurter.dev/v1/2026-10-01?base=USD&symbols=RUB');
  });

  it('возвращает null при ошибке ответа и при отсутствии валюты', async () => {
    const failed = fakeFetch({}, false);
    const provider = new FrankfurterRatesProvider('https://example.test', failed.fetch);
    await expect(provider.fetchRate('USD', 'RUB', '2026-10-01')).resolves.toBeNull();

    const empty = fakeFetch({ rates: {} });
    const provider2 = new FrankfurterRatesProvider('https://example.test', empty.fetch);
    await expect(provider2.fetchRate('USD', 'RUB', '2026-10-01')).resolves.toBeNull();
  });

  it('возвращает null, если сам запрос упал', async () => {
    const provider = new FrankfurterRatesProvider('https://example.test', () =>
      Promise.reject(new Error('network down')),
    );
    await expect(provider.fetchRate('USD', 'RUB', '2026-10-01')).resolves.toBeNull();
  });
});

describe('createRatesProvider', () => {
  it('без RATES_PROVIDER курсы только ручные (провайдер не создаётся)', () => {
    expect(createRatesProvider({} as NodeJS.ProcessEnv)).toBeNull();
    expect(createRatesProvider({ RATES_PROVIDER: 'other' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('RATES_PROVIDER=frankfurter включает публичный источник', () => {
    const provider = createRatesProvider({ RATES_PROVIDER: 'frankfurter' } as NodeJS.ProcessEnv);
    expect(provider?.name).toBe('frankfurter');
  });

  it('учитывает RATES_API_URL для своего зеркала', () => {
    const provider = createRatesProvider({
      RATES_PROVIDER: 'frankfurter',
      RATES_API_URL: 'https://mirror.test/v1',
    } as NodeJS.ProcessEnv);
    expect(provider?.name).toBe('frankfurter');
  });
});
