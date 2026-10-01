// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { barLayout, heatLevel, summarizeSeries } from '../src/lib/charts';

describe('barLayout (SVG-график без тяжёлых библиотек, ТЗ §3.4, §6)', () => {
  it('раскладывает столбцы по ширине и нормирует высоту к максимуму', () => {
    const bars = barLayout([0, 5, 10], 100, 50, 0);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toEqual({ x: 0, y: 50, width: 33.33, height: 0 });
    expect(bars[1]).toEqual({ x: 33.33, y: 25, width: 33.33, height: 25 });
    expect(bars[2]).toEqual({ x: 66.67, y: 0, width: 33.33, height: 50 });
  });

  it('учитывает промежуток между столбцами', () => {
    const bars = barLayout([1, 1], 40, 20, 4);
    expect(bars[0]).toEqual({ x: 0, y: 0, width: 18, height: 20 });
    expect(bars[1]).toEqual({ x: 22, y: 0, width: 18, height: 20 });
  });

  it('на пустом списке и при всех нулях не делится на ноль', () => {
    expect(barLayout([], 100, 50)).toEqual([]);
    expect(barLayout([0, 0], 100, 50).every((bar) => bar.height === 0)).toBe(true);
  });
});

describe('heatLevel (тепловая карта настроения, ТЗ §3.4)', () => {
  it('переводит среднее настроение в уровень 0–5', () => {
    expect(heatLevel(null)).toBe(0);
    expect(heatLevel(1.4)).toBe(1);
    expect(heatLevel(2.6)).toBe(3);
    expect(heatLevel(4.4)).toBe(4);
    expect(heatLevel(5)).toBe(5);
  });

  it('обрезает значения вне шкалы', () => {
    expect(heatLevel(0)).toBe(1);
    expect(heatLevel(9)).toBe(5);
  });
});

describe('summarizeSeries (текстовое описание графика для скринридеров)', () => {
  it('считает сумму, среднее и пик ряда', () => {
    const summary = summarizeSeries([
      { day: '2026-10-01', value: 0 },
      { day: '2026-10-02', value: 5 },
      { day: '2026-10-03', value: 10 },
    ]);
    expect(summary).toEqual({ total: 15, peakDay: '2026-10-03', peakValue: 10, average: 5 });
  });

  it('на пустом ряду возвращает нули и null для пика', () => {
    expect(summarizeSeries([])).toEqual({ total: 0, peakDay: null, peakValue: 0, average: 0 });
  });
});
