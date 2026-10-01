// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты чистой логики Telegram-бота (ТЗ §3.6, §4): разбор команд, разбор
// callback-кнопок и сборка inline-клавиатур. Без сети и без Telegram API.
import { describe, expect, it } from 'vitest';
import { moodKeyboard, parseCallback, parseCommand, undoKeyboard } from './commands';

describe('parseCommand', () => {
  it('разбирает /start с кодом привязки и без него', () => {
    expect(parseCommand('/start')).toEqual({ kind: 'start', code: null });
    expect(parseCommand('/start ABC123')).toEqual({ kind: 'start', code: 'ABC123' });
    expect(parseCommand('  /start   abc-123  ')).toEqual({ kind: 'start', code: 'abc-123' });
  });

  it('отбрасывает некорректный код привязки', () => {
    expect(parseCommand('/start !!!!')).toEqual({ kind: 'start', code: null });
    expect(parseCommand('/start a'.repeat(1))).toEqual({ kind: 'start', code: null });
  });

  it('понимает команды с упоминанием бота', () => {
    expect(parseCommand('/checkin@PulsBot')).toEqual({ kind: 'checkin' });
    expect(parseCommand('/today@PulsBot')).toEqual({ kind: 'today' });
    expect(parseCommand('/help@PulsBot')).toEqual({ kind: 'help' });
    expect(parseCommand('/unlink')).toEqual({ kind: 'unlink' });
  });

  it('распознаёт быструю запись текстом', () => {
    expect(parseCommand('кофе 250')).toEqual({ kind: 'quick', text: 'кофе 250' });
    expect(parseCommand('зарплата +80000')).toEqual({ kind: 'quick', text: 'зарплата +80000' });
  });

  it('всё остальное — unknown', () => {
    expect(parseCommand('привет')).toEqual({ kind: 'unknown' });
    expect(parseCommand('')).toEqual({ kind: 'unknown' });
    expect(parseCommand('/неизвестно')).toEqual({ kind: 'unknown' });
    expect(parseCommand('кофе')).toEqual({ kind: 'unknown' });
  });
});

describe('parseCallback', () => {
  it('разбирает настроение 1–5', () => {
    expect(parseCallback('mood:1')).toEqual({ kind: 'mood', mood: 1 });
    expect(parseCallback('mood:5')).toEqual({ kind: 'mood', mood: 5 });
  });

  it('отклоняет настроение вне диапазона', () => {
    expect(parseCallback('mood:0')).toEqual({ kind: 'unknown' });
    expect(parseCallback('mood:6')).toEqual({ kind: 'unknown' });
    expect(parseCallback('mood:abc')).toEqual({ kind: 'unknown' });
  });

  it('разбирает отмену транзакции', () => {
    expect(parseCallback('undo:tx_123')).toEqual({ kind: 'undo', transactionId: 'tx_123' });
    expect(parseCallback('undo:')).toEqual({ kind: 'unknown' });
    expect(parseCallback('прочее')).toEqual({ kind: 'unknown' });
  });
});

describe('клавиатуры', () => {
  it('кнопки настроения 1–5 с callback-данными', () => {
    const rows = moodKeyboard();
    const buttons = rows.flat();
    expect(buttons.map((button) => button.callbackData)).toEqual([
      'mood:1',
      'mood:2',
      'mood:3',
      'mood:4',
      'mood:5',
    ]);
    expect(buttons.every((button) => button.text.length > 0)).toBe(true);
  });

  it('кнопка «Отменить» несёт id транзакции', () => {
    const rows = undoKeyboard('tx_42');
    expect(rows[0][0]).toEqual({ text: 'Отменить', callbackData: 'undo:tx_42' });
  });
});
