// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseCheckinLine, parseMoodArg } from '../src/checkin-parser';

describe('parseCheckinLine', () => {
  it('разбирает полную однострочную форму', () => {
    const result = parseCheckinLine('4 энергия 3 стресс 2 сон 7.5 #спорт заметка про день');
    expect(result).toEqual({
      ok: true,
      input: {
        mood: 4,
        energy: 3,
        stress: 2,
        sleepHours: 7.5,
        tags: ['спорт'],
        note: 'заметка про день',
      },
    });
  });

  it('только настроение', () => {
    const result = parseCheckinLine('5');
    expect(result).toMatchObject({ ok: true, input: { mood: 5, tags: [] } });
  });

  it('запятая как десятичный разделитель, английские ключи, вода и шаги', () => {
    const result = parseCheckinLine('3 sleep 6,5 water 4 steps 9000');
    expect(result).toMatchObject({
      ok: true,
      input: { mood: 3, sleepHours: 6.5, water: 4, steps: 9000 },
    });
  });

  it('несколько тегов без повторов, регистр нормализуется', () => {
    const result = parseCheckinLine('2 #Работа #работа #ссора');
    expect(result).toMatchObject({ ok: true, input: { tags: ['работа', 'ссора'] } });
  });

  it('ключ без числа остаётся словом заметки', () => {
    const result = parseCheckinLine('4 сон был плохой');
    expect(result).toMatchObject({ ok: true, input: { note: 'сон был плохой' } });
  });

  it('ошибки: пусто, неверное настроение, значение вне диапазона', () => {
    expect(parseCheckinLine('  ')).toEqual({ ok: false, error: 'empty' });
    expect(parseCheckinLine('7')).toMatchObject({ ok: false, error: 'mood' });
    expect(parseCheckinLine('привет')).toMatchObject({ ok: false, error: 'mood' });
    expect(parseCheckinLine('4 энергия 9')).toMatchObject({
      ok: false,
      error: 'value',
      field: 'energy',
    });
    expect(parseCheckinLine('4 сон 30')).toMatchObject({ ok: false, field: 'sleepHours' });
  });
});

describe('parseMoodArg', () => {
  it('принимает 1–5 и отклоняет остальное', () => {
    expect(parseMoodArg('4')).toBe(4);
    expect(parseMoodArg(' 1 ')).toBe(1);
    expect(parseMoodArg('0')).toBeNull();
    expect(parseMoodArg('6')).toBeNull();
    expect(parseMoodArg('3.5')).toBeNull();
    expect(parseMoodArg('')).toBeNull();
  });
});
