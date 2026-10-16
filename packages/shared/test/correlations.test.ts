// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { computeCorrelations, correlationCandidates, type CorrelationDay } from '../src';

function day(i: number, spent: number, avgSleep: number | null): CorrelationDay {
  return {
    day: `2026-09-${String(i).padStart(2, '0')}`,
    spent,
    avgSleep,
    avgEnergy: null,
    avgMood: null,
  };
}

function sleepDays(badSpent: number[], goodSpent: number[]): CorrelationDay[] {
  return [
    ...badSpent.map((spent, index) => day(index + 1, spent, 5)),
    ...goodSpent.map((spent, index) => day(index + 11, spent, 8)),
  ];
}

describe('корреляции самочувствия и трат', () => {
  it('в дни с плохим сном траты выше — вывод значим на достаточной выборке', () => {
    const days = sleepDays(
      [1500, 1500, 1500, 1500, 1500, 1500, 1500],
      [1000, 1000, 1000, 1000, 1000, 1000, 1000],
    );
    const sleep = computeCorrelations(days).find((item) => item.metric === 'sleep')!;
    expect(sleep).toMatchObject({
      badDays: 7,
      goodDays: 7,
      diffPercent: 50,
      enough: true,
      significant: true,
    });
    expect(correlationCandidates([sleep])).toMatchObject([
      { type: 'sleep_spend', params: { percent: 50, days: 7 } },
    ]);
  });

  it('малая выборка (4 против 4) — вывода нет', () => {
    const days = sleepDays([1500, 1500, 1500, 1500], [1000, 1000, 1000, 1000]);
    const sleep = computeCorrelations(days).find((item) => item.metric === 'sleep')!;
    expect(sleep.badDays).toBe(4);
    expect(sleep.enough).toBe(false);
    expect(sleep.significant).toBe(false);
    expect(correlationCandidates([sleep])).toEqual([]);
  });

  it('достаточно в каждой группе, но меньше 14 дней суммарно — вывода нет', () => {
    const days = sleepDays(
      [1500, 1500, 1500, 1500, 1500, 1500, 1500],
      [1000, 1000, 1000, 1000, 1000, 1000],
    );
    const sleep = computeCorrelations(days).find((item) => item.metric === 'sleep')!;
    expect(sleep.badDays).toBe(7);
    expect(sleep.goodDays).toBe(6);
    expect(sleep.enough).toBe(false);
  });

  it('одна импульсная покупка не даёт «+900%»: медиана устойчива к выбросу', () => {
    const days = sleepDays(
      [4000, 100, 100, 100, 100, 100, 100],
      [100, 100, 100, 100, 100, 100, 100],
    );
    const sleep = computeCorrelations(days).find((item) => item.metric === 'sleep')!;
    expect(sleep.diffPercent).toBe(0);
    expect(sleep.significant).toBe(false);
  });

  it('заметной разницы нет или траты в плохие дни ниже — не значим', () => {
    const flat = sleepDays(
      [1000, 1000, 1000, 1000, 1000, 1000, 1000],
      [1050, 1050, 1050, 1050, 1050, 1050, 1050],
    );
    expect(computeCorrelations(flat)[0]!.significant).toBe(false);
    const lower = sleepDays(
      [500, 500, 500, 500, 500, 500, 500],
      [1000, 1000, 1000, 1000, 1000, 1000, 1000],
    );
    const result = computeCorrelations(lower)[0]!;
    expect(result.diffPercent).toBe(-50);
    expect(result.significant).toBe(false);
  });

  it('дни без значения метрики не учитываются, нулевая база даёт null', () => {
    const days = [
      ...sleepDays([100, 100, 100, 100, 100, 100, 100], [0, 0, 0, 0, 0, 0, 0]),
      day(99, 9999, null),
    ];
    const sleep = computeCorrelations(days)[0]!;
    expect(sleep.badDays + sleep.goodDays).toBe(14);
    expect(sleep.diffPercent).toBeNull();
    expect(sleep.significant).toBe(false);
  });
});
