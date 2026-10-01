// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Простая геометрия для SVG-графиков статистики (ТЗ §3.4, §6): раскладка
 * столбцов, уровень тепловой карты и сводка ряда для текстового описания
 * графика скринридерам. Тяжёлые библиотеки графиков не используются.
 */

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SeriesPoint {
  day: string;
  value: number;
}

export interface SeriesSummary {
  total: number;
  peakDay: string | null;
  peakValue: number;
  average: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Раскладывает столбцы диаграммы: значения нормируются к максимуму ряда,
 * нулевое значение остаётся линией у основания (height = 0).
 */
export function barLayout(
  values: readonly number[],
  width: number,
  height: number,
  gap = 1,
): Bar[] {
  if (values.length === 0) return [];

  const step = (width - gap * (values.length - 1)) / values.length;
  const barWidth = round2(step);
  const max = Math.max(...values, 0);

  return values.map((value, index) => {
    const ratio = max > 0 ? value / max : 0;
    const barHeight = round2(ratio * height);
    return {
      x: round2(index * (step + gap)),
      y: round2(height - barHeight),
      width: barWidth,
      height: barHeight,
    };
  });
}

/**
 * Уровень тепловой карты настроения 0–5 (0 — нет данных).
 * Среднее значение округляется к ближайшей ступени шкалы.
 */
export function heatLevel(mood: number | null): number {
  if (mood === null || !Number.isFinite(mood)) return 0;
  return Math.min(5, Math.max(1, Math.round(mood)));
}

/** Сводка ряда для текстового описания графика (доступность, ТЗ §6). */
export function summarizeSeries(points: readonly SeriesPoint[]): SeriesSummary {
  if (points.length === 0) {
    return { total: 0, peakDay: null, peakValue: 0, average: 0 };
  }

  let total = 0;
  let peak = points[0]!;

  for (const point of points) {
    total += point.value;
    if (point.value > peak.value) peak = point;
  }

  return {
    total: round2(total),
    peakDay: peak.value > 0 ? peak.day : null,
    peakValue: round2(peak.value),
    average: round2(total / points.length),
  };
}
