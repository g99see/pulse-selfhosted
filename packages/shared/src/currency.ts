// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Мультивалютность (ТЗ §3.2): чистые функции для работы с курсами — конвертация
 * суммы в основную валюту, кросс-курс через базовую валюту, выбор ближайшего
 * курса на дату (если на дату курса нет — последний предыдущий) и округление.
 *
 * Курс задаётся как «сколько единиц quote стоит одна единица base»
 * (например, base = USD, quote = RUB, rate = 95 → 1 USD = 95 RUB).
 * Суммы округляются до копеек (2 знака), курсы — до 8 знаков (Decimal(18, 8)).
 */
import { roundMoney } from './stats';

/** Точка курса: на дату `date` одна единица `base` стоит `rate` единиц `quote`. */
export interface RatePoint {
  date: string; // YYYY-MM-DD
  base: string;
  quote: string;
  rate: number;
}

/** Результат поиска курса: значение и дата, на которую он действует. */
export interface PickedRate {
  date: string;
  rate: number;
}

/** Округление курса до 8 знаков — точность колонки Decimal(18, 8). */
export function roundRate(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/** Последняя точка из набора с датой не позже целевой (или null). */
function latestBefore(points: readonly RatePoint[], targetDate: string): RatePoint | null {
  let best: RatePoint | null = null;
  for (const point of points) {
    if (point.date > targetDate) continue;
    if (!best || point.date > best.date) best = point;
  }
  return best;
}

/**
 * Ближайший курс на дату для пары base→quote: точная дата, иначе последний
 * предыдущий. Понимает обратную пару (возвращает 1/rate). Нет данных — null.
 */
export function pickRate(
  points: readonly RatePoint[],
  base: string,
  quote: string,
  targetDate: string,
): PickedRate | null {
  const direct = latestBefore(
    points.filter((point) => point.base === base && point.quote === quote),
    targetDate,
  );
  if (direct) return { date: direct.date, rate: direct.rate };

  const inverse = latestBefore(
    points.filter((point) => point.base === quote && point.quote === base),
    targetDate,
  );
  if (inverse && inverse.rate !== 0) return { date: inverse.date, rate: 1 / inverse.rate };
  return null;
}

/** Ближайший курс base→quote на дату (число) или null. */
export function nearestRate(
  points: readonly RatePoint[],
  base: string,
  quote: string,
  targetDate: string,
): number | null {
  return pickRate(points, base, quote, targetDate)?.rate ?? null;
}

/**
 * Кросс-курс «сколько единиц `to` стоит одна единица `from`» на дату.
 * Прямая/обратная пара, иначе — через базовую валюту пользователя.
 */
export function crossRate(
  points: readonly RatePoint[],
  from: string,
  to: string,
  base: string,
  targetDate: string,
): number | null {
  if (from === to) return 1;

  const direct = pickRate(points, from, to, targetDate);
  if (direct) return direct.rate;

  const fromToBase = from === base ? 1 : pickRate(points, from, base, targetDate)?.rate ?? null;
  if (fromToBase === null) return null;

  const toToBase = to === base ? 1 : pickRate(points, to, base, targetDate)?.rate ?? null;
  if (toToBase === null || toToBase === 0) return null;

  return fromToBase / toToBase;
}

/** Сумма в основной валюте: amount × rate, округлено до копеек. */
export function convertToBase(amount: number, rate: number): number {
  return roundMoney(amount * rate);
}
