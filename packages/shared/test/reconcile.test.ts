// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты сверки: деньги в копейках, порядок строк по цепочке остатков, сопоставление с Пульсом.
import { describe, expect, it } from 'vitest';
import {
  analyzeStatement,
  buildImportPreview,
  detectColumnMapping,
  matchStatement,
  parseCsv,
  parseImportTime,
  roundMoney,
  sumMoney,
  toCents,
  type PulseOperation,
  type StatementRow,
} from '../src';

function row(partial: Partial<StatementRow> & Pick<StatementRow, 'amountCents'>): StatementRow {
  return {
    externalId: null,
    date: '2026-09-01',
    time: '10:00',
    balanceCents: null,
    description: '',
    ...partial,
  };
}

describe('деньги в копейках', () => {
  it('sumMoney не копит хвост float', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(Array.from({ length: 1000 }, () => 0.01))).toBe(10);
    expect(toCents(-2757)).toBe(-275700);
    expect(toCents(179.05)).toBe(17905);
  });

  it('roundMoney округляет половинки вверх без ошибок float', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });
});

describe('разбор колонок банка', () => {
  const csv = [
    'Date,Time,Title,Amount,Balance,Transaction ID',
    '02.09.2026,17.45,Rejsekort Test,"-24,00","822,05",abc-1',
  ].join('\n');

  it('узнаёт время, баланс и ID транзакции', () => {
    const rows = parseCsv(csv);
    const mapping = detectColumnMapping(rows[0], rows.slice(1));
    expect(mapping).toMatchObject({
      date: 0,
      time: 1,
      description: 2,
      amount: 3,
      balance: 4,
      externalId: 5,
    });
    const [first] = buildImportPreview(rows, { mapping, hasHeader: true });
    expect(first).toMatchObject({
      date: '2026-09-02',
      time: '17:45',
      amount: 24,
      type: 'expense',
      balance: 822.05,
      externalId: 'abc-1',
    });
  });

  it('помечает дубль по ID банка, даже если описание изменилось', () => {
    const rows = parseCsv(csv);
    const mapping = detectColumnMapping(rows[0], rows.slice(1));
    const [first] = buildImportPreview(rows, {
      mapping,
      hasHeader: true,
      existingExternalIds: new Set(['abc-1']),
    });
    expect(first.duplicate).toBe(true);
  });

  it('parseImportTime', () => {
    expect(parseImportTime('9.05')).toBe('09:05');
    expect(parseImportTime('12:37:59')).toBe('12:37');
    expect(parseImportTime('25.00')).toBeNull();
    expect(parseImportTime('abc')).toBeNull();
  });
});

describe('цепочка остатков', () => {
  it('сходится на чистой выписке, порядок «новые сверху» восстанавливается', () => {
    const analysis = analyzeStatement([
      row({ date: '2026-09-02', amountCents: -2400, balanceCents: 7600 }),
      row({ date: '2026-09-01', amountCents: 10000, balanceCents: 10000 }),
    ]);
    expect(analysis.breaks).toEqual([]);
    expect(analysis.openingCents).toBe(0);
    expect(analysis.closingCents).toBe(7600);
    expect(analysis.totalCents).toBe(7600);
  });

  it('внутри одной минуты порядок подбирается по остаткам', () => {
    // В файле строки одной минуты идут «не в том» порядке.
    const analysis = analyzeStatement([
      row({ amountCents: -20, balanceCents: 9970, description: 'c' }),
      row({ amountCents: -10, balanceCents: 9990, description: 'b' }),
      row({ amountCents: 10000, balanceCents: 10000, description: 'a' }),
    ]);
    expect(analysis.breaks).toEqual([]);
    expect(analysis.closingCents).toBe(9970);
  });

  it('находит разрыв: в выписке пропущена операция', () => {
    const analysis = analyzeStatement(
      [
        row({ date: '2026-09-03', amountCents: -500, balanceCents: 7100 }),
        // пропущено: -2400 за 2 сентября
        row({ date: '2026-09-01', amountCents: 10000, balanceCents: 10000 }),
      ].map((r, i) => (i === 0 ? { ...r, balanceCents: 7100 } : r)),
    );
    expect(analysis.breaks).toHaveLength(1);
    expect(analysis.breaks[0]).toMatchObject({ expectedCents: 9500, actualCents: 7100 });
  });
});

describe('сопоставление выписки и Пульса', () => {
  const statement = [
    row({ externalId: 'a', date: '2026-09-01', amountCents: -1000, description: 'Кофе' }),
    row({ externalId: 'b', date: '2026-09-02', amountCents: -2400, description: 'Метро' }),
    row({ externalId: 'c', date: '2026-09-02', amountCents: -2400, description: 'Метро' }),
  ];
  const op = (id: string, partial: Partial<PulseOperation>): PulseOperation => ({
    id,
    externalId: null,
    date: '2026-09-01',
    amountCents: -1000,
    description: '',
    manual: false,
    ...partial,
  });

  it('полное совпадение — расхождений нет', () => {
    const result = matchStatement(statement, [
      op('1', { externalId: 'a' }),
      op('2', { externalId: 'b', date: '2026-09-02', amountCents: -2400 }),
      op('3', { externalId: 'c', date: '2026-09-02', amountCents: -2400 }),
    ]);
    expect(result.missingInPulse).toEqual([]);
    expect(result.extraInPulse).toEqual([]);
  });

  it('пропавшая и лишняя операции', () => {
    const result = matchStatement(statement, [
      op('1', { externalId: 'a' }),
      op('2', { externalId: 'b', date: '2026-09-02', amountCents: -2400 }),
      op('x', { date: '2026-09-04', amountCents: -777, manual: true }),
    ]);
    expect(result.missingInPulse.map((r) => r.externalId)).toEqual(['c']);
    expect(result.extraInPulse.map((o) => o.id)).toEqual(['x']);
  });

  it('вторая такая же операция — не парная первой (дубль в Пульсе виден)', () => {
    const result = matchStatement(statement.slice(0, 1), [
      op('1', { externalId: 'a' }),
      op('2', { date: '2026-09-01', amountCents: -1000, description: 'Кофе' }),
    ]);
    expect(result.extraInPulse.map((o) => o.id)).toEqual(['2']);
  });
});
