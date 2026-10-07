// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты декларативного каталога достижений (ТЗ v2 §4).
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_METRICS,
  ACHIEVEMENT_RARITIES,
  ACHIEVEMENT_TEXTS,
  achievementDescription,
  achievementMessages,
  metricsForEvent,
  progressFor,
  reachedTiers,
} from '../src/achievement-catalog';

describe('каталог достижений', () => {
  it('не меньше 150 достижений, у многих три уровня', () => {
    expect(ACHIEVEMENT_CATALOG.length).toBeGreaterThanOrEqual(150);
    expect(ACHIEVEMENT_CATALOG.filter((a) => a.tiers.length === 3).length).toBeGreaterThan(30);
  });

  it('коды уникальны', () => {
    const codes = ACHIEVEMENT_CATALOG.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('группы, редкость, метрики и уровни из допустимых наборов', () => {
    for (const item of ACHIEVEMENT_CATALOG) {
      expect(ACHIEVEMENT_GROUPS).toContain(item.group);
      expect(ACHIEVEMENT_RARITIES).toContain(item.rarity);
      expect(ACHIEVEMENT_METRICS).toContain(item.metric);
      expect(item.icon.length).toBeGreaterThan(0);
      for (const tier of item.tiers) expect(ACHIEVEMENT_LEVELS).toContain(tier.level);
    }
  });

  it('пороги строго возрастают, уровни — бронза < серебро < золото', () => {
    for (const item of ACHIEVEMENT_CATALOG) {
      expect(item.tiers.length).toBeGreaterThanOrEqual(1);
      expect(item.tiers.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < item.tiers.length; i += 1) {
        expect(item.tiers[i]!.threshold, item.code).toBeGreaterThan(item.tiers[i - 1]!.threshold);
        expect(ACHIEVEMENT_LEVELS.indexOf(item.tiers[i]!.level)).toBeGreaterThan(
          ACHIEVEMENT_LEVELS.indexOf(item.tiers[i - 1]!.level),
        );
      }
      expect(item.tiers[0]!.threshold).toBeGreaterThan(0);
      expect(item.tiers[item.tiers.length - 1]!.level).toBe('gold');
    }
  });

  it('i18n: тексты ru и en заданы, паритет плейсхолдера {n}', () => {
    for (const item of ACHIEVEMENT_CATALOG) {
      const text = ACHIEVEMENT_TEXTS[item.code]!;
      for (const locale of ['ru', 'en'] as const) {
        expect(text[locale].title.length, `${item.code} ${locale}`).toBeGreaterThan(0);
        expect(text[locale].description.length).toBeGreaterThan(0);
      }
      expect(text.ru.description.includes('{n}')).toBe(text.en.description.includes('{n}'));
    }
    const ru = achievementMessages('ru');
    const en = achievementMessages('en');
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ru).length).toBe(ACHIEVEMENT_CATALOG.length * 2);
  });

  it('есть все четыре группы и скрытые достижения', () => {
    for (const group of ACHIEVEMENT_GROUPS) {
      expect(ACHIEVEMENT_CATALOG.some((a) => a.group === group)).toBe(true);
    }
    expect(ACHIEVEMENT_CATALOG.some((a) => a.hidden)).toBe(true);
  });

  it('нет привязки к соцфункциям', () => {
    const text = JSON.stringify(ACHIEVEMENT_CATALOG) + JSON.stringify(ACHIEVEMENT_TEXTS);
    expect(text).not.toMatch(/follow|подпис|семь|family|challenge|челлендж|post/i);
  });
});

describe('прогресс и события', () => {
  const streak = ACHIEVEMENT_CATALOG.find((a) => a.code === 'checkin_streak')!;

  it('уровни и порог следующего', () => {
    expect(reachedTiers(streak, 6)).toEqual([]);
    expect(reachedTiers(streak, 30).map((t) => t.level)).toEqual(['bronze', 'silver']);
    expect(progressFor(streak, 0)).toMatchObject({ level: null, progress: 0 });
    expect(progressFor(streak, 3).next).toEqual({ level: 'bronze', threshold: 7 });
    expect(progressFor(streak, 7).level).toBe('bronze');
    expect(progressFor(streak, 7).next?.threshold).toBe(30);
    // от порога бронзы (7) до серебра (30): 18.5 из 23
    expect(progressFor(streak, 18.5).progress).toBeCloseTo(0.5);
    expect(progressFor(streak, 500)).toMatchObject({ level: 'gold', next: null, progress: 1 });
  });

  it('метрики привязаны к событиям', () => {
    expect(metricsForEvent('checkin')).toContain('checkin_count');
    expect(metricsForEvent('checkin')).not.toContain('goal_count');
    expect(metricsForEvent('goal')).toContain('goal_best_percent');
  });

  it('описание подставляет порог', () => {
    expect(achievementDescription('checkin_streak', 7, 'ru')).toContain('7');
  });
});
