// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Корреляции самочувствия и трат (ТЗ v2 §7): «в дни с плохим сном ты тратишь
 * на X% больше». Чистая функция по рядам DailyStat; выводы появляются только
 * при достаточной выборке в обеих группах дней. Это наблюдение о привычках,
 * не диагноз и не причинная связь.
 */
import { roundMoney } from './stats';

export const CORRELATION_METRICS = ['sleep', 'energy', 'mood'] as const;
export type CorrelationMetric = (typeof CORRELATION_METRICS)[number];

/** Окно анализа, дней. */
export const CORRELATION_WINDOW_DAYS = 60;
/** Минимум дней с данными в каждой группе («плохие» и «обычные»). */
export const CORRELATION_MIN_SAMPLES = 4;
/** Минимальная разница средних трат, %, чтобы считать её заметной. */
export const CORRELATION_MIN_DIFF_PERCENT = 15;

/** «Плохой» день: значение метрики строго ниже порога. */
export const CORRELATION_BAD_BELOW: Record<CorrelationMetric, number> = {
  sleep: 6,
  energy: 3,
  mood: 3,
};

export interface CorrelationDay {
  day: string;
  spent: number;
  avgSleep: number | null;
  avgEnergy: number | null;
  avgMood: number | null;
}

export interface CorrelationDto {
  metric: CorrelationMetric;
  /** Дней с плохим значением / с обычным. */
  badDays: number;
  goodDays: number;
  /** Средние траты в день в каждой группе (null — группа пуста). */
  badAverage: number | null;
  goodAverage: number | null;
  /** На сколько % траты в плохие дни выше (отрицательное — ниже); null — нет данных. */
  diffPercent: number | null;
  /** Хватает ли выборки для вывода. */
  enough: boolean;
  /** Вывод значим: выборка достаточна и траты в плохие дни выше на порог и более. */
  significant: boolean;
}

export interface CorrelationsResponse {
  windowDays: number;
  correlations: CorrelationDto[];
}

function metricValue(day: CorrelationDay, metric: CorrelationMetric): number | null {
  if (metric === 'sleep') return day.avgSleep;
  if (metric === 'energy') return day.avgEnergy;
  return day.avgMood;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundMoney(values.reduce((total, value) => total + value, 0) / values.length);
}

/** Сравнивает средние траты в «плохие» и «обычные» дни по каждой метрике. */
export function computeCorrelations(
  days: readonly CorrelationDay[],
  options: { minSamples?: number; minDiffPercent?: number } = {},
): CorrelationDto[] {
  const minSamples = options.minSamples ?? CORRELATION_MIN_SAMPLES;
  const minDiff = options.minDiffPercent ?? CORRELATION_MIN_DIFF_PERCENT;

  return CORRELATION_METRICS.map((metric) => {
    const bad: number[] = [];
    const good: number[] = [];
    for (const day of days) {
      const value = metricValue(day, metric);
      if (value === null) continue;
      (value < CORRELATION_BAD_BELOW[metric] ? bad : good).push(day.spent);
    }

    const badAverage = mean(bad);
    const goodAverage = mean(good);
    const enough = bad.length >= minSamples && good.length >= minSamples;
    // База сравнения нулевая — процент не определён.
    const diffPercent =
      badAverage !== null && goodAverage !== null && goodAverage > 0
        ? Math.round(((badAverage - goodAverage) / goodAverage) * 100)
        : null;

    return {
      metric,
      badDays: bad.length,
      goodDays: good.length,
      badAverage,
      goodAverage,
      diffPercent,
      enough,
      significant: enough && diffPercent !== null && diffPercent >= minDiff,
    };
  });
}
