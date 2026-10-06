// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Разбор однострочного чек-ина из мессенджера (ТЗ v2 §4):
 * `4 энергия 3 стресс 2 сон 7.5 #спорт заметка` → CheckInInput.
 * Чистая функция без побочных эффектов; результат всегда проходит CheckInInputSchema,
 * поэтому все каналы (web, Telegram, Discord, голос) пишут одну и ту же запись.
 */
import { CheckInInputSchema, type CheckInInput } from './checkin';

/** Поля, которые можно указать ключевым словом. */
export type CheckInLineField = 'energy' | 'stress' | 'sleepHours' | 'water' | 'steps';

const KEYWORDS: Record<string, CheckInLineField> = {
  энергия: 'energy',
  энергии: 'energy',
  energy: 'energy',
  стресс: 'stress',
  stress: 'stress',
  сон: 'sleepHours',
  сна: 'sleepHours',
  sleep: 'sleepHours',
  вода: 'water',
  воды: 'water',
  water: 'water',
  шаги: 'steps',
  шагов: 'steps',
  steps: 'steps',
};

export type CheckInLineResult =
  | { ok: true; input: CheckInInput }
  | { ok: false; error: 'empty' | 'mood' | 'value'; field?: CheckInLineField | 'mood' };

function parseNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  const value = Number(token.replace(',', '.'));
  return token.trim() !== '' && Number.isFinite(value) ? value : null;
}

/** Теги: `#спорт` → `спорт`, нижний регистр, без повторов. */
export function normalizeTag(raw: string): string {
  return raw.replace(/^#+/, '').trim().toLowerCase().slice(0, 64);
}

/**
 * Разбирает строку после команды `/checkin`. Первое слово — настроение 1–5,
 * дальше пары «ключ значение», `#теги` и всё остальное — заметка.
 */
export function parseCheckinLine(text: string): CheckInLineResult {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: 'empty' };

  const mood = parseNumber(tokens[0]);
  if (mood === null || !Number.isInteger(mood) || mood < 1 || mood > 5) {
    return { ok: false, error: 'mood', field: 'mood' };
  }

  const draft: Record<string, unknown> = { mood };
  const tags: string[] = [];
  const noteWords: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const field = KEYWORDS[token.toLowerCase()];
    const numeric = field ? parseNumber(tokens[index + 1]) : null;

    if (field && numeric !== null) {
      draft[field] = numeric;
      index += 1;
    } else if (token.startsWith('#') && normalizeTag(token).length > 0) {
      const tag = normalizeTag(token);
      if (!tags.includes(tag)) tags.push(tag);
    } else {
      noteWords.push(token);
    }
  }

  draft.tags = tags;
  if (noteWords.length > 0) draft.note = noteWords.join(' ');

  const parsed = CheckInInputSchema.safeParse(draft);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    const field = typeof path === 'string' ? (path as CheckInLineField | 'mood') : undefined;
    return { ok: false, error: 'value', field };
  }
  return { ok: true, input: parsed.data };
}

/** `/mood 4` → 4; null — не число 1–5. */
export function parseMoodArg(text: string): number | null {
  const value = parseNumber(text.trim());
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}
