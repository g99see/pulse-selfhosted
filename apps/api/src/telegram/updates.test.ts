// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты нормализации Update из Telegram в собственный тип (ТЗ §3.6):
// Telegram API спрятан за интерфейсом, поэтому ядро бота работает с простыми
// структурами и в тестах не требует ни сети, ни grammy.
import { describe, expect, it } from 'vitest';
import { normalizeUpdate } from './updates';

describe('normalizeUpdate', () => {
  it('извлекает текстовое сообщение', () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: -1001234567890, username: 'puls_user' },
        from: { id: 42, username: 'puls_user' },
        text: 'кофе 250',
      },
    };

    expect(normalizeUpdate(update)).toEqual({
      kind: 'message',
      chatId: '-1001234567890',
      text: 'кофе 250',
      username: 'puls_user',
    });
  });

  it('извлекает callback-нажатие', () => {
    const update = {
      update_id: 2,
      callback_query: {
        id: 'cb-1',
        data: 'mood:4',
        from: { id: 42 },
        message: { message_id: 11, chat: { id: 777 } },
      },
    };

    expect(normalizeUpdate(update)).toEqual({
      kind: 'callback',
      chatId: '777',
      data: 'mood:4',
      callbackQueryId: 'cb-1',
      messageId: '11',
    });
  });

  it('возвращает null для чужих апдейтов и мусора', () => {
    expect(normalizeUpdate({ update_id: 3 })).toBeNull();
    expect(normalizeUpdate({ update_id: 4, message: { chat: { id: 1 } } })).toBeNull();
    expect(normalizeUpdate(null)).toBeNull();
    expect(normalizeUpdate('nope')).toBeNull();
  });
});
