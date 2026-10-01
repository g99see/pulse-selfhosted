// SPDX-License-Identifier: AGPL-3.0-or-later
// TDD-тесты чистой логики инсайтов (ТЗ §3.5): правила на данных пользователя
// без медицинских диагнозов, отбор недельного разбора, оценка «полезно/нет»,
// недельное расписание и справочник служб поддержки.
import { describe, expect, it } from 'vitest';
import {
  SUPPORT_COUNTRIES,
  SUPPORT_RESOURCES,
  budgetExceededCandidates,
  budgetSuggestionCandidate,
  categorySpendRiseCandidates,
  countryFromTimezone,
  feedbackStatsFromRows,
  hiddenInsightTypes,
  insightTypePenalty,
  isWeeklyReportDue,
  isoWeekKey,
  lowEnergyStreakCandidates,
  moodWithSportCandidate,
  rankInsights,
  selectWeeklyInsights,
  supportResourcesFor,
  weeklyReportSlot,
  wellbeingConcernCandidates,
  type InsightCandidate,
  type InsightType,
} from '../src/insights';

const NO_STATS: { type: InsightType; useful: number; notUseful: number }[] = [];

describe('Рост трат по категории (ТЗ §3.5)', () => {
  it('находит категорию, выросшую на 20% и больше', () => {
    const candidates = categorySpendRiseCandidates(
      [{ categoryId: 'cafe', categoryName: 'Кафе', total: 1400, count: 4 }],
      [{ categoryId: 'cafe', categoryName: 'Кафе', total: 1000, count: 3 }],
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'category_spend_up',
      textKey: 'insights.text.categorySpendUp',
      params: { category: 'Кафе', percent: 40 },
    });
  });

  it('не считает рост ниже порога и не делит на ноль', () => {
    expect(
      categorySpendRiseCandidates(
        [{ categoryId: 'food', categoryName: 'Еда', total: 1050, count: 2 }],
        [{ categoryId: 'food', categoryName: 'Еда', total: 1000, count: 2 }],
      ),
    ).toHaveLength(0);

    expect(
      categorySpendRiseCandidates(
        [{ categoryId: 'food', categoryName: 'Еда', total: 900, count: 2 }],
        [],
      ),
    ).toHaveLength(0);
  });

  it('сортирует по росту и ограничивает число инсайтов', () => {
    const candidates = categorySpendRiseCandidates(
      [
        { categoryId: 'a', categoryName: 'A', total: 2000, count: 1 },
        { categoryId: 'b', categoryName: 'B', total: 3000, count: 1 },
      ],
      [
        { categoryId: 'a', categoryName: 'A', total: 1000, count: 1 },
        { categoryId: 'b', categoryName: 'B', total: 1000, count: 1 },
      ],
      { max: 1 },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].params.category).toBe('B');
  });
});

describe('Три дня подряд низкой энергии (ТЗ §3.5)', () => {
  it('замечает текущую серию из трёх дней с энергией ниже 2', () => {
    const candidates = lowEnergyStreakCandidates([
      { day: '2026-09-28', energy: 3 },
      { day: '2026-09-29', energy: 1 },
      { day: '2026-09-30', energy: 1 },
      { day: '2026-10-01', energy: 1 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'low_energy_streak',
      textKey: 'insights.text.lowEnergyStreak',
      params: { days: 3 },
    });
  });

  it('не срабатывает на двух днях и на прерванной серии', () => {
    expect(
      lowEnergyStreakCandidates([
        { day: '2026-09-30', energy: 1 },
        { day: '2026-10-01', energy: 1 },
      ]),
    ).toHaveLength(0);

    expect(
      lowEnergyStreakCandidates([
        { day: '2026-09-29', energy: 1 },
        { day: '2026-09-30', energy: 4 },
        { day: '2026-10-01', energy: 1 },
      ]),
    ).toHaveLength(0);
  });
});

describe('Настроение выше в дни со спортом (ТЗ §3.5)', () => {
  it('находит связь по тегу, когда разница заметна', () => {
    const candidate = moodWithSportCandidate([
      { day: '2026-09-28', mood: 5, tags: ['спорт'] },
      { day: '2026-09-29', mood: 4, tags: ['спорт'] },
      { day: '2026-09-30', mood: 4, tags: ['спорт'] },
      { day: '2026-10-01', mood: 2, tags: [] },
      { day: '2026-10-02', mood: 3, tags: [] },
    ]);

    expect(candidate).toMatchObject({
      type: 'mood_with_sport',
      textKey: 'insights.text.moodWithSport',
      params: { withSport: 4.3, withoutSport: 2.5, delta: 1.8 },
    });
  });

  it('молчит, когда данных мало или разницы нет', () => {
    expect(
      moodWithSportCandidate([
        { day: '2026-09-29', mood: 4, tags: ['спорт'] },
        { day: '2026-10-01', mood: 4, tags: [] },
      ]),
    ).toBeNull();

    expect(
      moodWithSportCandidate([
        { day: '2026-09-28', mood: 3, tags: ['спорт'] },
        { day: '2026-09-29', mood: 3, tags: ['спорт'] },
        { day: '2026-09-30', mood: 3, tags: ['спорт'] },
        { day: '2026-10-01', mood: 3, tags: [] },
        { day: '2026-10-02', mood: 3, tags: [] },
      ]),
    ).toBeNull();
  });
});

describe('Превышение бюджета (ТЗ §3.5)', () => {
  it('предупреждает о категориях, вышедших за лимит', () => {
    const candidates = budgetExceededCandidates([
      { categoryId: 'taxi', categoryName: 'Транспорт', limit: 2000, spent: 2600 },
      { categoryId: 'food', categoryName: 'Еда', limit: 10000, spent: 5000 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'budget_exceeded',
      textKey: 'insights.text.budgetExceeded',
      params: { category: 'Транспорт', percent: 130 },
    });
  });
});

describe('Предложение недели — бюджет по категории (ТЗ §3.5)', () => {
  it('предлагает недельный бюджет и описывает действие', () => {
    const candidate = budgetSuggestionCandidate(
      { categoryId: 'taxi', categoryName: 'Транспорт', total: 1400 },
      { month: '2026-10', hasBudget: false },
    );

    expect(candidate).toMatchObject({
      type: 'budget_suggestion',
      textKey: 'insights.text.budgetSuggestion',
      params: { category: 'Транспорт', amount: 1400 },
      action: {
        kind: 'budget',
        categoryId: 'taxi',
        categoryName: 'Транспорт',
        month: '2026-10',
        weeklyLimit: 1400,
        monthlyLimit: 6000,
      },
    });
  });

  it('не предлагает то, что уже ограничено бюджетом', () => {
    expect(
      budgetSuggestionCandidate(
        { categoryId: 'taxi', categoryName: 'Транспорт', total: 1400 },
        { month: '2026-10', hasBudget: true },
      ),
    ).toBeNull();
  });
});

describe('Мягкое предложение помощи (ТЗ §3.5)', () => {
  it('срабатывает на шести днях подряд с настроением 1', () => {
    const days = [
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ];
    const candidates = wellbeingConcernCandidates(days.map((day) => ({ day, mood: 1 })));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'wellbeing_concern',
      textKey: 'insights.text.wellbeingConcern',
      params: { days: 6 },
    });
  });

  it('не срабатывает на пяти днях и на перемежающемся настроении', () => {
    const five = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
    expect(wellbeingConcernCandidates(five.map((day) => ({ day, mood: 1 })))).toHaveLength(0);

    expect(
      wellbeingConcernCandidates([
        { day: '2026-09-28', mood: 1 },
        { day: '2026-09-29', mood: 2 },
        { day: '2026-09-30', mood: 1 },
        { day: '2026-10-01', mood: 1 },
      ]),
    ).toHaveLength(0);
  });
});

describe('Оценка «полезно / не полезно» (ТЗ §3.5)', () => {
  it('понижает вес типа, который часто отмечают бесполезным', () => {
    expect(insightTypePenalty(0, 0)).toBe(1);
    expect(insightTypePenalty(3, 0)).toBeGreaterThan(1);
    expect(insightTypePenalty(0, 2)).toBeLessThan(1);
  });

  it('скрывает типы с двумя и более «не полезно» без одобрений', () => {
    expect(
      hiddenInsightTypes([
        { type: 'low_energy_streak', useful: 0, notUseful: 2 },
        { type: 'mood_with_sport', useful: 0, notUseful: 1 },
        { type: 'category_spend_up', useful: 3, notUseful: 3 },
      ]),
    ).toEqual(['low_energy_streak']);
  });

  it('сортирует кандидатов с учётом оценки', () => {
    const candidates: InsightCandidate[] = [
      { type: 'mood_with_sport', textKey: 'k', params: {}, weight: 10 },
      { type: 'low_energy_streak', textKey: 'k', params: {}, weight: 11 },
    ];
    const ranked = rankInsights(candidates, [
      { type: 'low_energy_streak', useful: 0, notUseful: 3 },
    ]);
    expect(ranked.map((candidate) => candidate.type)).toEqual(['mood_with_sport']);
  });

  it('сворачивает строки счётчиков из groupBy', () => {
    expect(
      feedbackStatsFromRows([
        { type: 'category_spend_up', feedback: 'useful', count: 2 },
        { type: 'category_spend_up', feedback: 'not_useful', count: 1 },
        { type: 'unknown_type', feedback: 'useful', count: 5 },
      ]),
    ).toEqual([{ type: 'category_spend_up', useful: 2, notUseful: 1 }]);
  });
});

describe('Недельный разбор: 3 инсайта и 1 предложение (ТЗ §3.5)', () => {
  it('берёт три самых весомых инсайта и предложение', () => {
    const insight = (type: InsightType, weight: number): InsightCandidate => ({
      type,
      textKey: `insights.text.${type}`,
      params: {},
      weight,
    });
    const result = selectWeeklyInsights(
      [
        insight('category_spend_up', 40),
        insight('low_energy_streak', 3),
        insight('mood_with_sport', 1.8),
        insight('budget_exceeded', 130),
        {
          type: 'budget_suggestion',
          textKey: 'insights.text.budgetSuggestion',
          params: {},
          weight: 0,
          action: {
            kind: 'budget',
            categoryId: 'taxi',
            categoryName: 'Транспорт',
            month: '2026-10',
            weeklyLimit: 1400,
            monthlyLimit: 6000,
          },
        },
      ],
      NO_STATS,
    );

    expect(result.insights).toHaveLength(3);
    expect(result.insights.map((candidate) => candidate.type)).toEqual([
      'budget_exceeded',
      'category_spend_up',
      'low_energy_streak',
    ]);
    expect(result.suggestion?.type).toBe('budget_suggestion');
  });

  it('пропускает скрытые типы при отборе', () => {
    const insight = (type: InsightType, weight: number): InsightCandidate => ({
      type,
      textKey: `insights.text.${type}`,
      params: {},
      weight,
    });
    const result = selectWeeklyInsights(
      [insight('category_spend_up', 40), insight('low_energy_streak', 3)],
      [{ type: 'category_spend_up', useful: 0, notUseful: 2 }],
    );
    expect(result.insights.map((candidate) => candidate.type)).toEqual(['low_energy_streak']);
  });
});

describe('Недельное расписание (ТЗ §3.5: воскресенье 19:00)', () => {
  it('определяет номер ISO-недели', () => {
    expect(isoWeekKey('2026-10-04')).toBe('2026-W40');
    expect(isoWeekKey('2026-10-05')).toBe('2026-W41');
  });

  it('берёт ближайшее воскресенье 19:00 по часовому поясу пользователя', () => {
    // 2026-10-04 17:00 UTC = 20:00 в Москве — слот уже наступил.
    expect(
      weeklyReportSlot(new Date('2026-10-04T17:00:00.000Z'), 'Europe/Moscow').toISOString(),
    ).toBe('2026-10-04T16:00:00.000Z');
    // 2026-10-04 15:00 UTC = 18:00 в Москве — слот ещё не наступил, берём прошлое воскресенье.
    expect(
      weeklyReportSlot(new Date('2026-10-04T15:00:00.000Z'), 'Europe/Moscow').toISOString(),
    ).toBe('2026-09-27T16:00:00.000Z');
  });

  it('наступает один раз в неделю в окне планировщика', () => {
    expect(
      isWeeklyReportDue(
        new Date('2026-10-04T19:30:00.000Z'),
        'UTC',
        new Date('2026-10-04T16:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      isWeeklyReportDue(
        new Date('2026-10-04T20:00:00.000Z'),
        'UTC',
        new Date('2026-10-04T19:30:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('Справочник служб поддержки (ТЗ §3.5)', () => {
  it('покрывает страны из ТЗ и общий международный пункт', () => {
    expect([...SUPPORT_COUNTRIES]).toEqual(['RU', 'UA', 'KZ', 'BY', 'US', 'GB', 'DE', 'INT']);
    for (const country of SUPPORT_COUNTRIES) {
      const resource = SUPPORT_RESOURCES.find((item) => item.country === country);
      expect(resource, `нет контакта для ${country}`).toBeTruthy();
      expect(resource!.nameKey).toMatch(/^support\.\w+\.name$/);
      expect(resource!.descriptionKey).toMatch(/^support\.\w+\.description$/);
    }
  });

  it('определяет страну по часовому поясу и добавляет международный контакт', () => {
    expect(countryFromTimezone('Europe/Moscow')).toBe('RU');
    expect(countryFromTimezone('Europe/Kyiv')).toBe('UA');
    expect(countryFromTimezone('Asia/Almaty')).toBe('KZ');
    expect(countryFromTimezone('Europe/Minsk')).toBe('BY');
    expect(countryFromTimezone('America/New_York')).toBe('US');
    expect(countryFromTimezone('Europe/London')).toBe('GB');
    expect(countryFromTimezone('Europe/Berlin')).toBe('DE');
    expect(countryFromTimezone('Australia/Sydney')).toBe('INT');

    const forRussia = supportResourcesFor('Europe/Moscow');
    expect(forRussia.map((resource) => resource.country)).toContain('RU');
    expect(forRussia.map((resource) => resource.country)).toContain('INT');
  });

  it('не ставит диагнозов и не обещает лечения', () => {
    const forbidden = ['диагноз', 'лечени', 'заболеван', 'терап'];
    for (const resource of SUPPORT_RESOURCES) {
      const haystack = `${resource.nameKey} ${resource.descriptionKey}`.toLowerCase();
      for (const word of forbidden) expect(haystack).not.toContain(word);
    }
  });
});
