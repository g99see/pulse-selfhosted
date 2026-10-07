// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты сопоставления магазинов (ТЗ v2 §9): нормализация, алиасы, шаблоны,
// нечёткое совпадение и приоритет личных магазинов.
import { describe, expect, it } from 'vitest';
import {
  MERCHANT_FUZZY_THRESHOLD,
  matchMerchant,
  matchMerchantWithPriority,
  merchantPatternText,
  normalizeMerchantText,
  searchMerchants,
  type MerchantEntry,
} from '../src/merchants';

const REMA: MerchantEntry = {
  id: 'rema-1000',
  name: 'Rema 1000',
  aliases: ['rema', 'rema1000'],
  patterns: ['^rema\\b'],
  defaultCategory: 'groceries',
  country: 'DK',
};

const LIDL: MerchantEntry = {
  id: 'lidl',
  name: 'Lidl',
  aliases: ['lidl'],
  patterns: ['^lidl\\b'],
  defaultCategory: 'groceries',
};

const PENNY: MerchantEntry = {
  id: 'penny',
  name: 'Penny Markt',
  aliases: ['penny markt'],
  patterns: ['^penny\\s\\d'],
  defaultCategory: 'groceries',
};

describe('normalizeMerchantText', () => {
  it('убирает регистр, коды терминалов, города и номера точек', () => {
    expect(normalizeMerchantText('KORT REMA 1000 KØBENHAVN BUTIK 4471')).toBe('rema');
  });

  it('раскладывает диакритику и приводит буквы', () => {
    expect(normalizeMerchantText('Føtex Food')).toBe('fotex food');
    expect(normalizeMerchantText('ØRSTED')).toBe('orsted');
  });

  it('убирает время и даты', () => {
    expect(normalizeMerchantText('Lidl 12:37 20261007 KORT')).toBe('lidl');
  });

  it('оставляет значимые токены с цифрами внутри названия', () => {
    // «365discount» — слитный токен, номер точки не отбрасывается.
    expect(normalizeMerchantText('365discount BERLIN')).toBe('365discount');
  });
});

describe('merchantPatternText', () => {
  it('сохраняет цифры для проверки шаблонов', () => {
    expect(merchantPatternText('PENNY MARKT 4471 BERLIN')).toBe('penny markt 4471 berlin');
  });
});

describe('matchMerchant', () => {
  it('находит по точному алиасу', () => {
    const match = matchMerchant('KORT REMA KØBENHAVN POS 1', [REMA]);
    expect(match?.entry.id).toBe('rema-1000');
    expect(match?.method).toBe('alias');
  });

  it('находит по шаблону, когда алиас не подошёл', () => {
    // «PENNY 4471»: алиас «penny markt» не подходит, шаблон ^penny\s(markt|\d) — да.
    const match = matchMerchant('PENNY 4471 BERLIN', [PENNY]);
    expect(match?.method).toBe('pattern');
    expect(match?.entry.id).toBe('penny');
  });

  it('находит нечётким совпадением с опечаткой', () => {
    const match = matchMerchant('LIDLL', [LIDL]);
    expect(match?.entry.id).toBe('lidl');
    expect(match?.method).toBe('fuzzy');
  });

  it('возвращает null, если ничего не подошло', () => {
    expect(matchMerchant('МЕСТНЫЙ РЫНОК СПБ', [REMA, LIDL])).toBeNull();
  });

  it('уважает порог нечёткого совпадения', () => {
    expect(MERCHANT_FUZZY_THRESHOLD).toBeGreaterThan(0.5);
    // Слишком далёкая строка не должна матчиться даже нечётко.
    expect(matchMerchant('zzzqqq', [LIDL])).toBeNull();
  });
});

describe('matchMerchantWithPriority', () => {
  const own: MerchantEntry[] = [
    {
      id: 'own-1',
      name: 'Rema 1000 локальный',
      aliases: ['rema'],
      defaultCategory: 'cat-own',
    },
  ];

  it('личный магазин приоритетнее общей базы', () => {
    const match = matchMerchantWithPriority('REMA 1000', own, [REMA]);
    expect(match?.entry.source).toBe('user');
    expect(match?.entry.defaultCategory).toBe('cat-own');
  });

  it('падает в общую базу, если личный магазин не подошёл', () => {
    const match = matchMerchantWithPriority('LIDL BERLIN', own, [LIDL]);
    expect(match?.entry.source).toBe('world');
  });
});

describe('searchMerchants', () => {
  it('ищет по подстроке нормализованного названия', () => {
    const result = searchMerchants('rem', [
      { ...REMA, source: 'world' },
      { ...LIDL, source: 'world' },
    ]);
    expect(result.map((entry) => entry.id)).toEqual(['rema-1000']);
  });
});
