// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Нормализация Update из Telegram Bot API (ТЗ §3.6) в собственные структуры:
 * ядро бота не зависит от типов grammy, а тесты — от реальной сети.
 */
export interface IncomingMessage {
  kind: 'message';
  chatId: string;
  text: string;
  username: string | null;
}

export interface IncomingCallback {
  kind: 'callback';
  chatId: string;
  data: string;
  callbackQueryId: string;
  messageId: string | null;
}

export type IncomingUpdate = IncomingMessage | IncomingCallback;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Идентификаторы Telegram приходят числами; для хранения и сравнения — строка. */
function asId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Update → сообщение или нажатие кнопки; null — всё остальное. */
export function normalizeUpdate(update: unknown): IncomingUpdate | null {
  const root = asRecord(update);
  if (!root) return null;

  const message = asRecord(root.message);
  if (message) {
    const chat = asRecord(message.chat);
    const chatId = chat ? asId(chat.id) : null;
    const text = asText(message.text);
    if (chatId === null || text === null) return null;

    const from = asRecord(message.from);
    return {
      kind: 'message',
      chatId,
      text,
      username: from ? asText(from.username) : null,
    };
  }

  const callback = asRecord(root.callback_query);
  if (callback) {
    const origin = asRecord(callback.message);
    const chat = origin ? asRecord(origin.chat) : null;
    const chatId = chat ? asId(chat.id) : null;
    const data = asText(callback.data);
    const callbackQueryId = asId(callback.id);
    if (chatId === null || data === null || callbackQueryId === null) return null;

    return {
      kind: 'callback',
      chatId,
      data,
      callbackQueryId,
      messageId: origin ? asId(origin.message_id) : null,
    };
  }

  return null;
}
