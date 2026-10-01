// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистая логика разбора команд и callback-кнопок Telegram-бота (ТЗ §3.6, §4):
 * никаких обращений к сети и БД — только превращение входящего текста в
 * намерение. Реальный Telegram API спрятан за интерфейсом (telegram-api.ts),
 * поэтому всё здесь покрыто быстрыми unit-тестами.
 */
import { parseQuickTransaction } from '@puls/shared';

/** Намерение пользователя по тексту сообщения. */
export type TelegramCommand =
  | { kind: 'start'; code: string | null }
  | { kind: 'checkin' }
  | { kind: 'today' }
  | { kind: 'help' }
  | { kind: 'unlink' }
  | { kind: 'quick'; text: string }
  | { kind: 'unknown' };

/** Намерение по нажатой inline-кнопке. */
export type TelegramCallback =
  { kind: 'mood'; mood: number } | { kind: 'undo'; transactionId: string } | { kind: 'unknown' };

export interface InlineButton {
  text: string;
  callbackData: string;
}

/** Символы одноразового кода привязки: латиница, цифры, дефис и подчёркивание. */
export const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

const MOOD_EMOJI = ['😞', '🙁', '😐', '🙂', '😄'] as const;

/** Разбирает текст сообщения в команду бота. */
export function parseCommand(raw: string): TelegramCommand {
  const text = raw.trim();
  if (text.length === 0) return { kind: 'unknown' };

  if (text.startsWith('/')) {
    const [head, ...rest] = text.split(/\s+/);
    // «/checkin@PulsBot» — команда с упоминанием бота.
    const name = head.slice(1).split('@')[0].toLowerCase();

    switch (name) {
      case 'start': {
        const candidate = rest[0];
        return {
          kind: 'start',
          code: candidate && LINK_CODE_PATTERN.test(candidate) ? candidate : null,
        };
      }
      case 'checkin':
        return { kind: 'checkin' };
      case 'today':
        return { kind: 'today' };
      case 'help':
        return { kind: 'help' };
      case 'unlink':
        return { kind: 'unlink' };
      default:
        return { kind: 'unknown' };
    }
  }

  if (parseQuickTransaction(text)) return { kind: 'quick', text };
  return { kind: 'unknown' };
}

/** Разбирает callback-данные inline-кнопки. */
export function parseCallback(data: string): TelegramCallback {
  const match = /^(mood|undo):(.+)$/.exec(data.trim());
  if (!match) return { kind: 'unknown' };

  const [, kind, value] = match;

  if (kind === 'mood') {
    const mood = Number(value);
    if (!Number.isInteger(mood) || mood < 1 || mood > 5) return { kind: 'unknown' };
    return { kind: 'mood', mood };
  }

  const transactionId = value.trim();
  if (transactionId.length === 0) return { kind: 'unknown' };
  return { kind: 'undo', transactionId };
}

/** Inline-кнопки настроения 1–5 (ТЗ §3.3): ответ за пять секунд из чата. */
export function moodKeyboard(): InlineButton[][] {
  return [MOOD_EMOJI.map((emoji, index) => ({ text: emoji, callbackData: `mood:${index + 1}` }))];
}

/** Кнопка «Отменить» под подтверждением быстрой записи (ТЗ §4). */
export function undoKeyboard(transactionId: string): InlineButton[][] {
  return [[{ text: 'Отменить', callbackData: `undo:${transactionId}` }]];
}
