// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты чистой логики Telegram-бота (ТЗ §3.6, §4): разбор команд, разбор
// callback-кнопок и сборка inline-клавиатур. Без сети и без Telegram API.
import { describe, expect, it } from 'vitest';
import { BOT_COMMANDS, moodKeyboard, parseCallback, parseCommand, undoKeyboard } from './commands';

describe('команды чек-ина (ТЗ v2 §4)', () => {
  it('/checkin без аргументов — диалог, с аргументами — быстрая форма', () => {
    expect(parseCommand('/checkin')).toEqual({ kind: 'checkin' });
    expect(parseCommand('/checkin 4 энергия 3 #спорт')).toEqual({
      kind: 'checkin-line',
      text: '4 энергия 3 #спорт',
    });
  });

  it('/mood N', () => {
    expect(parseCommand('/mood 4')).toEqual({ kind: 'mood', mood: 4 });
    expect(parseCommand('/mood@PulsBot 2')).toEqual({ kind: 'mood', mood: 2 });
    expect(parseCommand('/mood')).toEqual({ kind: 'mood', mood: null });
    expect(parseCommand('/mood 9')).toEqual({ kind: 'mood', mood: null });
  });

  it('callback диалога', () => {
    expect(parseCallback('ci:energy:3')).toEqual({ kind: 'checkin', action: 'ci:energy:3' });
  });
});

describe('parseCommand', () => {
  it('разбирает /start с токеном привязки и без него', () => {
    expect(parseCommand('/start')).toEqual({ kind: 'start', token: null });
    expect(parseCommand('/start ABC12345')).toEqual({ kind: 'start', token: 'ABC12345' });
    expect(parseCommand('  /start   abc-12345  ')).toEqual({ kind: 'start', token: 'abc-12345' });
  });

  it('отбрасывает некорректный токен привязки', () => {
    expect(parseCommand('/start !!!!')).toEqual({ kind: 'start', token: null });
    expect(parseCommand('/start a')).toEqual({ kind: 'start', token: null });
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
      'ci:mood:1',
      'ci:mood:2',
      'ci:mood:3',
      'ci:mood:4',
      'ci:mood:5',
    ]);
    expect(buttons.every((button) => button.text.length > 0)).toBe(true);
  });

  it('кнопка «Отменить» несёт id транзакции', () => {
    const rows = undoKeyboard('tx_42');
    expect(rows[0][0]).toEqual({ text: 'Отменить', callbackData: 'undo:tx_42' });
  });
});

describe('/spent (ТЗ v2 §7)', () => {
  it('«сумма описание» и «описание сумма» → строка для быстрого ввода', () => {
    expect(parseCommand('/spent 12 кофе')).toEqual({ kind: 'spent', text: 'кофе 12' });
    expect(parseCommand('/spent кофе 12')).toEqual({ kind: 'spent', text: 'кофе 12' });
    expect(parseCommand('/spent 12,5 такси домой')).toEqual({
      kind: 'spent',
      text: 'такси домой 12.5',
    });
    expect(parseCommand('/spent@PulsBot 300 обед')).toEqual({ kind: 'spent', text: 'обед 300' });
  });

  it('знак в аргументе игнорируется — это всегда расход', () => {
    expect(parseCommand('/spent +50 обед')).toEqual({ kind: 'spent', text: 'обед 50' });
    expect(parseCommand('/spent обед +50')).toEqual({ kind: 'spent', text: 'обед 50' });
  });

  it('без суммы или без описания — text null', () => {
    expect(parseCommand('/spent')).toEqual({ kind: 'spent', text: null });
    expect(parseCommand('/spent кофе')).toEqual({ kind: 'spent', text: null });
    expect(parseCommand('/spent 12')).toEqual({ kind: 'spent', text: null });
  });

  it('меню команд содержит spent, mood, today', () => {
    expect(BOT_COMMANDS.map((item) => item.command)).toEqual(
      expect.arrayContaining(['spent', 'mood', 'today']),
    );
    expect(BOT_COMMANDS.every((item) => item.description.length <= 256)).toBe(true);
  });
});
