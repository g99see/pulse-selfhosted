// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Шкала самочувствия 1–5 из ТЗ §8.
 * Красный для настроения не используется — плохой день не должен выглядеть ошибкой.
 */
export const MOOD_SCALE = [1, 2, 3, 4, 5] as const;

export type Mood = (typeof MOOD_SCALE)[number];

export const MOOD_EMOJI: Record<Mood, string> = {
  1: '😞',
  2: '🙁',
  3: '😐',
  4: '🙂',
  5: '😄',
};

/** Цвета шкалы настроения: приглушённый синий → серо-бежевый → солнечно-жёлтый. */
export const MOOD_COLORS: Record<Mood, string> = {
  1: '#7C8DB5',
  2: '#9AA6BE',
  3: '#D8D3CB',
  4: '#E9C46A',
  5: '#F5C542',
};

export function isMood(value: unknown): value is Mood {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Среднее настроение; null, если данных нет. Возвращает число с одним знаком после запятой. */
export function moodAverage(values: readonly number[]): number | null {
  const valid = values.filter(isMood);
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, value) => acc + value, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

/** Среднее по значениям, где поле заполнено (null/undefined пропускаются), до 0.1; null — данных нет. */
export function optionalAverage(values: readonly (number | null | undefined)[]): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number');
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((acc, value) => acc + value, 0) / valid.length) * 10) / 10;
}
