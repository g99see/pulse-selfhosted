// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты CSV: экранирование RFC 4180 и защита от инъекции формул (ТЗ §6).
import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('экранирует запятые, кавычки и переводы строк по RFC 4180', () => {
    expect(csvCell('обычное')).toBe('обычное');
    expect(csvCell('Еда, кафе')).toBe('"Еда, кафе"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('строка\nвторая')).toBe('"строка\nвторая"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('нейтрализует формулы в строках пользователя (=, +, -, @, TAB)', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell('+79301234567')).toBe("'+79301234567");
    expect(csvCell('@echo off')).toBe("'@echo off");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('\t=1+1')).toBe("'\t=1+1");
  });

  it('не портит числа и даты, сгенерированные сервером', () => {
    expect(csvCell(-450)).toBe('-450');
    expect(csvCell(1500.5)).toBe('1500.5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(new Date('2026-10-01T10:00:00.000Z'))).toBe('2026-10-01T10:00:00.000Z');
  });

  it('пустые значения и массивы', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(['работа', 'спорт'])).toBe('"[""работа"",""спорт""]"');
  });

  it('безопасную строку с экранированием кавычек формулой не помечает', () => {
    expect(csvCell('сумма 5*5')).toBe('сумма 5*5');
  });
});

describe('toCsv', () => {
  it('пишет заголовок и строки через CRLF, экранируя значения', () => {
    const csv = toCsv(
      ['id', 'name', 'amount'],
      [
        { id: 'a1', name: 'Еда, кафе', amount: 450 },
        { id: 'a2', name: '=ИНЪЕКЦИЯ', amount: -100 },
      ],
    );

    expect(csv).toBe('id,name,amount\r\na1,"Еда, кафе",450\r\na2,\'=ИНЪЕКЦИЯ,-100\r\n');
  });

  it('для пустой выборки отдаёт только заголовок', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });

  it('подставляет пустую строку для отсутствующей колонки', () => {
    expect(toCsv(['a', 'b'], [{ a: 1 }])).toBe('a,b\r\n1,\r\n');
  });
});
