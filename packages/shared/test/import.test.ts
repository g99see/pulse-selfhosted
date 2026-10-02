// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты импорта банковской выписки из CSV (ТЗ §3.2): парсер RFC 4180,
// определение разделителя и колонок, разбор дат и сумм, предпросмотр.
import { describe, expect, it } from 'vitest';
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  ImportCommitRequestSchema,
  ImportPreviewRequestSchema,
  buildImportPreview,
  detectColumnMapping,
  detectDelimiter,
  detectHeaderRow,
  importOccurrenceKey,
  importRowKey,
  parseCsv,
  parseImportAmount,
  parseImportDate,
  summarizeImportRows,
} from '../src/import';

describe('лимиты импорта', () => {
  it('ограничивает файл 2 МБ и 10 000 строк', () => {
    expect(IMPORT_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(IMPORT_MAX_ROWS).toBe(10_000);
  });
});

describe('detectDelimiter', () => {
  it('распознаёт запятую', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('распознаёт точку с запятой', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('распознаёт табуляцию', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('игнорирует разделители внутри кавычек', () => {
    expect(detectDelimiter('"a;b";c\n"x;y";z')).toBe(';');
  });

  it('по умолчанию возвращает запятую', () => {
    expect(detectDelimiter('однаколонка\nвторая')).toBe(',');
  });
});

describe('parseCsv (RFC 4180)', () => {
  it('разбирает простой файл с разделителем по умолчанию', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('поддерживает кавычки с разделителями и экранированные кавычки', () => {
    expect(parseCsv('"Иванов, И.";"ООО ""Ромашка"""\n1;2', ';')).toEqual([
      ['Иванов, И.', 'ООО "Ромашка"'],
      ['1', '2'],
    ]);
  });

  it('сохраняет перевод строки внутри кавычек', () => {
    expect(parseCsv('name;comment\n"a";"строка 1\nстрока 2"', ';')).toEqual([
      ['name', 'comment'],
      ['a', 'строка 1\nстрока 2'],
    ]);
  });

  it('убирает BOM и понимает переводы строк CRLF', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('отбрасывает пустые строки в конце', () => {
    expect(parseCsv('a,b\n1,2\n\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('detectHeaderRow', () => {
  it('видит строку заголовков по ключевым словам', () => {
    expect(
      detectHeaderRow([
        ['Дата', 'Сумма', 'Описание'],
        ['01.10.2026', '450,00', 'Обед'],
      ]),
    ).toBe(true);
  });

  it('видит данные без заголовка', () => {
    expect(
      detectHeaderRow([
        ['01.10.2026', '450,00', 'Обед'],
        ['02.10.2026', '200,00', 'Такси'],
      ]),
    ).toBe(false);
  });
});

describe('detectColumnMapping', () => {
  it('сопоставляет русские заголовки', () => {
    const mapping = detectColumnMapping(['Дата операции', 'Сумма', 'Описание', 'Тип']);
    expect(mapping).toMatchObject({ date: 0, amount: 1, description: 2, type: 3 });
  });

  it('сопоставляет английские заголовки', () => {
    const mapping = detectColumnMapping(['Date', 'Amount', 'Description']);
    expect(mapping).toMatchObject({ date: 0, amount: 1, description: 2 });
  });

  it('распознаёт отдельные колонки дебет/кредит', () => {
    const mapping = detectColumnMapping(['Дата', 'Расход', 'Поступление', 'Назначение']);
    expect(mapping).toMatchObject({ date: 0, debit: 1, credit: 2, description: 3 });
  });

  it('определяет колонки по данным без заголовков', () => {
    const mapping = detectColumnMapping(
      ['', '', ''],
      [
        ['01.10.2026', '-450,00', 'Обед'],
        ['02.10.2026', '-200,00', 'Такси'],
        ['03.10.2026', '80000,00', 'Зарплата'],
      ],
    );
    expect(mapping).toMatchObject({ date: 0, amount: 1, description: 2 });
  });
});

describe('parseImportDate', () => {
  it('разбирает dd.MM.yyyy', () => {
    expect(parseImportDate('01.10.2026')).toBe('2026-10-01');
  });

  it('разбирает yyyy-MM-dd и dd/MM/yyyy', () => {
    expect(parseImportDate('2026-10-01')).toBe('2026-10-01');
    expect(parseImportDate('01/10/2026')).toBe('2026-10-01');
  });

  it('игнорирует время после даты', () => {
    expect(parseImportDate('01.10.2026 12:34:56')).toBe('2026-10-01');
  });

  it('отклоняет несуществующую дату и мусор', () => {
    expect(parseImportDate('31.02.2026')).toBeNull();
    expect(parseImportDate('не дата')).toBeNull();
  });
});

describe('parseImportAmount', () => {
  it('разбирает «1 234,56»', () => {
    expect(parseImportAmount('1 234,56')).toBe(1234.56);
  });

  it('разбирает «-450.00»', () => {
    expect(parseImportAmount('-450.00')).toBe(-450);
  });

  it('разбирает разные разделители разрядов', () => {
    expect(parseImportAmount('1,234.56')).toBe(1234.56);
    expect(parseImportAmount('1.234,56')).toBe(1234.56);
  });

  it('разбирает отрицательную сумму в скобках и неразрывный пробел', () => {
    expect(parseImportAmount('(500,00)')).toBe(-500);
    expect(parseImportAmount('2\u00A0000,00')).toBe(2000);
  });

  it('отклоняет мусор', () => {
    expect(parseImportAmount('abc')).toBeNull();
    expect(parseImportAmount('')).toBeNull();
  });
});

describe('importRowKey', () => {
  it('нормализует описание и сумму', () => {
    expect(importRowKey('2026-10-01', 450, '  Обед   в кафе ')).toBe(
      '2026-10-01|450.00|обед в кафе',
    );
  });
});

describe('buildImportPreview', () => {
  const rows = [
    ['Дата операции', 'Сумма', 'Описание', 'Тип'],
    ['01.10.2026', '-450,00', 'Обед в кафе', 'Расход'],
    ['02.10.2026', '80000,00', 'Зарплата', 'Доход'],
    ['03.10.2026', 'мусор', 'Такси', 'Расход'],
    ['не дата', '-100,00', 'Кофе', 'Расход'],
  ];

  it('строит предпросмотр: дата, сумма, тип, категория', () => {
    const preview = buildImportPreview(rows, {
      mapping: { date: 0, amount: 1, description: 2, type: 3 },
      hasHeader: true,
    });

    expect(preview).toHaveLength(4);
    expect(preview[0]).toMatchObject({
      rowNumber: 2,
      date: '2026-10-01',
      amount: 450,
      type: 'expense',
      description: 'Обед в кафе',
      categoryName: 'Еда',
      duplicate: false,
      error: null,
    });
    expect(preview[1]).toMatchObject({
      rowNumber: 3,
      date: '2026-10-02',
      amount: 80000,
      type: 'income',
      categoryName: 'Зарплата',
    });
  });

  it('помечает битые строки ошибкой', () => {
    const preview = buildImportPreview(rows, {
      mapping: { date: 0, amount: 1, description: 2 },
      hasHeader: true,
    });
    expect(preview[2].error).toBe('invalid_amount');
    expect(preview[3].error).toBe('invalid_date');
    expect(summarizeImportRows(preview)).toMatchObject({ total: 4, valid: 2, errors: 2 });
  });

  it('определяет тип по знаку суммы при отсутствии колонки типа', () => {
    const preview = buildImportPreview(
      [
        ['Дата', 'Сумма', 'Описание'],
        ['01.10.2026', '-450,00', 'Обед'],
        ['02.10.2026', '80000,00', 'Зарплата'],
      ],
      { mapping: { date: 0, amount: 1, description: 2 }, hasHeader: true },
    );
    expect(preview[0].type).toBe('expense');
    expect(preview[1].type).toBe('income');
  });

  it('поддерживает отдельные колонки дебет/кредит', () => {
    const preview = buildImportPreview(
      [
        ['Дата', 'Расход', 'Поступление', 'Назначение'],
        ['01.10.2026', '450,00', '', 'Обед'],
        ['02.10.2026', '', '80000,00', 'Зарплата'],
      ],
      { mapping: { date: 0, debit: 1, credit: 2, description: 3 }, hasHeader: true },
    );
    expect(preview[0]).toMatchObject({ type: 'expense', amount: 450 });
    expect(preview[1]).toMatchObject({ type: 'income', amount: 80000 });
  });

  it('одинаковые строки в одном файле — разные операции, не дубли', () => {
    const preview = buildImportPreview(
      [
        ['Дата', 'Сумма', 'Описание'],
        ['01.10.2026', '-450,00', 'Обед'],
        ['01.10.2026', '-450,00', 'обед'],
        ['02.10.2026', '-200,00', 'Такси'],
      ],
      {
        mapping: { date: 0, amount: 1, description: 2 },
        hasHeader: true,
        existingKeys: new Set([importRowKey('2026-10-02', 200, 'Такси')]),
      },
    );
    expect(preview[0]).toMatchObject({ duplicate: false, occurrence: 0 });
    expect(preview[1]).toMatchObject({ duplicate: false, occurrence: 1 });
    expect(preview[2]).toMatchObject({ duplicate: true, occurrence: 0 });
  });

  it('против существующих учитывает их количество', () => {
    const key = importRowKey('2026-10-01', 24, 'Rejsekort');
    const rows = [
      ['Дата', 'Сумма', 'Описание'],
      ['01.10.2026', '-24,00', 'Rejsekort'],
      ['01.10.2026', '-24,00', 'Rejsekort'],
      ['01.10.2026', '-24,00', 'Rejsekort'],
    ];
    const preview = buildImportPreview(rows, {
      mapping: { date: 0, amount: 1, description: 2 },
      hasHeader: true,
      existingKeys: new Map([[key, 2]]),
    });
    expect(preview.map((row) => row.duplicate)).toEqual([true, true, false]);
    expect(importOccurrenceKey(key, 0)).toBe(key);
    expect(importOccurrenceKey(key, 2)).toBe(`${key}#2`);
  });
});

describe('схемы запросов импорта', () => {
  it('принимает запрос предпросмотра', () => {
    const parsed = ImportPreviewRequestSchema.parse({ csv: 'a,b\n1,2' });
    expect(parsed.csv).toBe('a,b\n1,2');
  });

  it('отклоняет пустой CSV и неверный разделитель', () => {
    expect(ImportPreviewRequestSchema.safeParse({ csv: '' }).success).toBe(false);
    expect(ImportPreviewRequestSchema.safeParse({ csv: 'a,b', delimiter: '|' }).success).toBe(
      false,
    );
  });

  it('для завершения импорта требует счёт', () => {
    expect(ImportCommitRequestSchema.safeParse({ csv: 'a,b', accountId: 'acc1' }).success).toBe(
      true,
    );
    expect(ImportCommitRequestSchema.safeParse({ csv: 'a,b' }).success).toBe(false);
  });
});
