// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистая логика разбора команд и callback-кнопок Telegram-бота (ТЗ §3.6, §4):
 * никаких обращений к сети и БД — только превращение входящего текста в
 * намерение. Реальный Telegram API спрятан за интерфейсом (telegram-api.ts),
 * поэтому всё здесь покрыто быстрыми unit-тестами.
 */
import {
  CHECKIN_ACTION_PREFIX,
  MOOD_EMOJI,
  parseMoodArg,
  parseQuickTransaction,
  type Mood,
} from '@puls/shared';

/** Намерение пользователя по тексту сообщения. */
export type TelegramCommand =
  | { kind: 'start'; code: string | null }
  | { kind: 'checkin' }
  /** `/checkin 4 энергия 3 …` — быстрая форма одной строкой. */
  | { kind: 'checkin-line'; text: string }
  /** `/mood 4`; mood null — аргумент не распознан. */
  | { kind: 'mood'; mood: number | null }
  | { kind: 'today' }
  /** `/spent 12 кофе`; text — «кофе 12» для быстрого разбора, null — не распознано. */
  | { kind: 'spent'; text: string | null }
  | { kind: 'help' }
  | { kind: 'unlink' }
  | { kind: 'quick'; text: string }
  | { kind: 'unknown' };

/** Намерение по нажатой inline-кнопке. */
export type TelegramCallback =
  | { kind: 'mood'; mood: number }
  /** Нажатие кнопки диалога чек-ина (`ci:…`). */
  | { kind: 'checkin'; action: string }
  | { kind: 'undo'; transactionId: string }
  | { kind: 'unknown' };

export interface InlineButton {
  text: string;
  callbackData: string;
}

/** Символы одноразового кода привязки: латиница, цифры, дефис и подчёркивание. */
export const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

/**
 * Аргументы `/spent`: «12 кофе», «12.5 такси» или «кофе 12» → «кофе 12».
 * Это всегда расход: знак +/− в аргументе игнорируется.
 */
export function parseSpentArgs(args: string): string | null {
  const text = args.trim();
  const leading = /^[+-]?\s*(\d{1,9}(?:[.,]\d{1,2})?)\s+(.+)$/u.exec(text);
  const candidate = leading
    ? `${leading[2]!.trim()} ${leading[1]}`
    : text.replace(/\s*[+-](?=\s*\d)/u, ' ');
  const parsed = parseQuickTransaction(candidate, 'expense');
  if (!parsed) return null;
  return `${parsed.title} ${parsed.amount}`;
}

/** Список команд для меню бота (setMyCommands). */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: 'checkin', description: 'Чек-ин: настроение, энергия, сон' },
  { command: 'mood', description: 'Быстро записать настроение: /mood 4' },
  { command: 'spent', description: 'Записать трату: /spent 12 кофе' },
  { command: 'today', description: 'Траты и настроение за сегодня' },
  { command: 'help', description: 'Справка по командам' },
  { command: 'unlink', description: 'Отвязать чат' },
];

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
      case 'checkin': {
        const line = rest.join(' ');
        return line.length > 0 ? { kind: 'checkin-line', text: line } : { kind: 'checkin' };
      }
      case 'mood':
        return { kind: 'mood', mood: parseMoodArg(rest.join(' ')) };
      case 'today':
        return { kind: 'today' };
      case 'spent':
        return { kind: 'spent', text: parseSpentArgs(rest.join(' ')) };
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
  const trimmed = data.trim();
  if (trimmed.startsWith(CHECKIN_ACTION_PREFIX)) return { kind: 'checkin', action: trimmed };

  const match = /^(mood|undo):(.+)$/.exec(trimmed);
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

/**
 * Inline-кнопки настроения 1–5 (ТЗ §3.3): первый шаг диалога чек-ина. Нажатие
 * без активного черновика запускает диалог с уже выбранным настроением.
 */
export function moodKeyboard(): InlineButton[][] {
  return [
    ([1, 2, 3, 4, 5] as Mood[]).map((value) => ({
      text: MOOD_EMOJI[value],
      callbackData: `${CHECKIN_ACTION_PREFIX}mood:${value}`,
    })),
  ];
}

/** Кнопки шага диалога → inline-клавиатура Telegram. */
export function dialogKeyboard(rows: { label: string; action: string }[][]): InlineButton[][] {
  return rows.map((row) =>
    row.map((button) => ({ text: button.label, callbackData: button.action })),
  );
}

/** Кнопка «Отменить» под подтверждением быстрой записи (ТЗ §4). */
export function undoKeyboard(transactionId: string): InlineButton[][] {
  return [[{ text: 'Отменить', callbackData: `undo:${transactionId}` }]];
}
