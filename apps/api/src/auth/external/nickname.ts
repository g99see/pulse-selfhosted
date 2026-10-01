// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Генерация никнейма для пользователей, созданных через внешний вход (ТЗ §3.1).
 * Никнейм нейтральный — без эмодзи и пробелов, только латиница, цифры и дефис,
 * чтобы проходить серверную валидацию и не зависеть от данных провайдера.
 */
import { NICKNAME_REGEX, RESERVED_NICKNAMES } from '@puls/shared';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 6;
const NICKNAME_PREFIX = 'puls';
export const DEFAULT_NICKNAME_ATTEMPTS = 10;

/** Один нейтральный кандидат вида `puls-4f7k2a`. */
export function generateNickname(random: () => number = Math.random): string {
  let suffix = '';
  for (let index = 0; index < SUFFIX_LENGTH; index += 1) {
    const position = Math.min(
      ALPHABET.length - 1,
      Math.max(0, Math.floor(random() * ALPHABET.length)),
    );
    suffix += ALPHABET[position];
  }
  const candidate = `${NICKNAME_PREFIX}-${suffix}`;

  // Страховка от неожидаемого random: результат обязан быть валидным.
  if (!NICKNAME_REGEX.test(candidate) || RESERVED_NICKNAMES.includes(candidate)) {
    return `${NICKNAME_PREFIX}-${Date.now().toString(36).slice(-SUFFIX_LENGTH)}`;
  }
  return candidate;
}

/** Первый свободный никнейм за отведённое число попыток. */
export async function uniqueNickname(
  isTaken: (candidate: string) => boolean | Promise<boolean>,
  random: () => number = Math.random,
  maxAttempts = DEFAULT_NICKNAME_ATTEMPTS,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateNickname(random);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error('Не удалось подобрать свободный никнейм: попробуйте другое имя');
}
