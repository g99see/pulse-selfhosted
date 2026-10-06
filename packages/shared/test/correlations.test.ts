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

describe('корреляции самочувствия и трат', () => {
  it('в дни с плохим сном траты выше — вывод значим', () => {
    const days = [
      ...[1, 2, 3, 4].map((i) => day(i, 1500, 5)),
      ...[5, 6, 7, 8].map((i) => day(i, 1000, 8)),
    ];
    const sleep = computeCorrelations(days).find((item) => item.metric === 'sleep')!;
    expect(sleep).toMatchObject({
      badDays: 4,
      goodDays: 4,
      diffPercent: 50,
      enough: true,
      significant: true,
    });
    expect(correlationCandidates([sleep])).toMatchObject([
      { type: 'sleep_spend', params: { percent: 50, days: 4 } },
    ]);
  });

  it('малая выборка — вывода нет', () => {
    const days = [
      day(1, 1500, 5),
      day(2, 1000, 8),
      day(3, 1000, 8),
      day(4, 1000, 8),
      day(5, 1000, 8),
    ];
    const sleep = computeCorrelations(days).find((item) => item.metric === 'sleep')!;
    expect(sleep.enough).toBe(false);
    expect(sleep.significant).toBe(false);
    expect(correlationCandidates([sleep])).toEqual([]);
  });

  it('заметной разницы нет или траты в плохие дни ниже — не значим', () => {
    const flat = [
      ...[1, 2, 3, 4].map((i) => day(i, 1000, 5)),
      ...[5, 6, 7, 8].map((i) => day(i, 1050, 8)),
    ];
    expect(computeCorrelations(flat)[0]!.significant).toBe(false);
    const lower = [
      ...[1, 2, 3, 4].map((i) => day(i, 500, 5)),
      ...[5, 6, 7, 8].map((i) => day(i, 1000, 8)),
    ];
    const result = computeCorrelations(lower)[0]!;
    expect(result.diffPercent).toBe(-50);
    expect(result.significant).toBe(false);
  });

  it('дни без значения метрики не учитываются, нулевая база даёт null', () => {
    const days = [
      ...[1, 2, 3, 4].map((i) => day(i, 100, 5)),
      ...[5, 6, 7, 8].map((i) => day(i, 0, 8)),
      day(9, 9999, null),
    ];
    const sleep = computeCorrelations(days)[0]!;
    expect(sleep.badDays + sleep.goodDays).toBe(8);
    expect(sleep.diffPercent).toBeNull();
    expect(sleep.significant).toBe(false);
  });
});
