// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты целей накоплений (ТЗ §3.2, сценарий 2): схемы, прогресс, нужный
// взнос в месяц, прогноз даты по фактическому темпу и вехи 25/50/75/100%.
import { describe, expect, it } from 'vitest';
import {
  GOAL_EMOJI_PRESETS,
  GOAL_MILESTONES,
  GoalCreateSchema,
  GoalDepositSchema,
  GoalUpdateSchema,
  crossedMilestones,
  forecastGoalDate,
  goalPacePerMonth,
  goalProgress,
  isGoalImageUrl,
  reachedMilestones,
  requiredMonthlyContribution,
} from '../src/goals';

describe('GoalCreateSchema', () => {
  it('принимает цель со сроком, картинкой и приватностью', () => {
    const parsed = GoalCreateSchema.parse({
      title: 'Ноутбук',
      targetAmount: 120000,
      deadline: '2027-03-01',
      image: '💻',
      visibility: 'private',
    });
    expect(parsed).toMatchObject({
      title: 'Ноутбук',
      targetAmount: 120000,
      savedAmount: 0,
      visibility: 'private',
    });
  });

  it('по умолчанию saved_amount = 0 и приватность «только мне»', () => {
    const parsed = GoalCreateSchema.parse({ title: 'Отпуск', targetAmount: 80000 });
    expect(parsed.savedAmount).toBe(0);
    expect(parsed.visibility).toBe('private');
    expect(parsed.deadline).toBeUndefined();
  });

  it('отклоняет пустое имя, нулевую цель и неизвестную приватность', () => {
    expect(GoalCreateSchema.safeParse({ title: '', targetAmount: 100 }).success).toBe(false);
    expect(GoalCreateSchema.safeParse({ title: 'x', targetAmount: 0 }).success).toBe(false);
    expect(
      GoalCreateSchema.safeParse({ title: 'x', targetAmount: 100, visibility: 'friends' }).success,
    ).toBe(false);
  });

  it('хранит картинку как эмодзи-пресет или URL без загрузки файлов', () => {
    expect(GoalCreateSchema.parse({ title: 'x', targetAmount: 1, image: '🎁' }).image).toBe('🎁');
    expect(
      GoalCreateSchema.parse({
        title: 'x',
        targetAmount: 1,
        image: 'https://cdn.example.com/goal.png',
      }).image,
    ).toBe('https://cdn.example.com/goal.png');
    expect(isGoalImageUrl('https://cdn.example.com/goal.png')).toBe(true);
    expect(isGoalImageUrl('🎁')).toBe(false);
    expect(GOAL_EMOJI_PRESETS.length).toBeGreaterThanOrEqual(6);
  });
});

describe('GoalUpdateSchema и GoalDepositSchema', () => {
  it('правит часть полей и запрещает отрицательное пополнение', () => {
    expect(GoalUpdateSchema.parse({ title: 'Новый' }).title).toBe('Новый');
    expect(GoalDepositSchema.parse({ amount: 5000 }).amount).toBe(5000);
    expect(GoalDepositSchema.safeParse({ amount: -1 }).success).toBe(false);
    expect(GoalDepositSchema.safeParse({ amount: 0 }).success).toBe(false);
  });
});

describe('goalProgress (ТЗ §3.2)', () => {
  it('считает прогресс в процентах', () => {
    expect(goalProgress(60000, 120000)).toBe(50);
    expect(goalProgress(30000, 120000)).toBe(25);
    expect(goalProgress(0, 120000)).toBe(0);
  });

  it('не превышает 100 при перевыполнении и не делит на ноль', () => {
    expect(goalProgress(150000, 120000)).toBe(100);
    expect(goalProgress(500, 0)).toBe(0);
  });
});

describe('requiredMonthlyContribution (сценарий 2: 120 000 ₽ к 1 марта → 24 000 ₽/мес)', () => {
  it('делит остаток на число месяцев до срока', () => {
    const from = new Date(Date.UTC(2026, 9, 1)); // 1 октября
    const deadline = new Date(Date.UTC(2027, 2, 1)); // 1 марта
    expect(requiredMonthlyContribution(120000, 0, deadline, from)).toBe(24000);
  });

  it('учитывает уже накопленное', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    const deadline = new Date(Date.UTC(2027, 2, 1));
    expect(requiredMonthlyContribution(120000, 60000, deadline, from)).toBe(12000);
  });

  it('без срока возвращает null, а при достижении цели — 0', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    expect(requiredMonthlyContribution(120000, 0, null, from)).toBeNull();
    expect(requiredMonthlyContribution(120000, 120000, new Date(Date.UTC(2027, 2, 1)), from)).toBe(
      0,
    );
  });
});

describe('goalPacePerMonth и forecastGoalDate (прогноз по фактическому темпу)', () => {
  it('считает среднемесячный темп по пополнениям', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    const pace = goalPacePerMonth([{ amount: 24000, date: from }], from);
    expect(pace).toBe(24000);
  });

  it('без пополнений темп нулевой, прогноза нет', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    expect(goalPacePerMonth([], from)).toBe(0);
    expect(forecastGoalDate(0, 120000, 0, from)).toBeNull();
  });

  it('прогнозирует дату достижения: 120 000 при темпе 24 000/мес → 1 марта', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    const forecast = forecastGoalDate(0, 120000, 24000, from);
    expect(forecast?.toISOString().slice(0, 10)).toBe('2027-03-01');
  });

  it('если цель уже достигнута — прогноз равен текущей дате', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    expect(forecastGoalDate(120000, 120000, 24000, from)?.toISOString().slice(0, 10)).toBe(
      '2026-10-01',
    );
  });
});

describe('вехи 25/50/75/100% (ТЗ сценарий 2: на 50% выдаётся достижение)', () => {
  it('перечисляет достигнутые пороги', () => {
    expect(GOAL_MILESTONES).toEqual([25, 50, 75, 100]);
    expect(reachedMilestones(0)).toEqual([]);
    expect(reachedMilestones(50)).toEqual([25, 50]);
    expect(reachedMilestones(100)).toEqual([25, 50, 75, 100]);
  });

  it('отдаёт только новую веху, пересечённую пополнением', () => {
    expect(crossedMilestones(40, 55)).toEqual([50]);
    expect(crossedMilestones(24, 26)).toEqual([25]);
    expect(crossedMilestones(50, 50)).toEqual([]);
    expect(crossedMilestones(90, 100)).toEqual([100]);
  });
});
