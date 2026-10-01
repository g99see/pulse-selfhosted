// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты чистых функций челленджей (ТЗ §4, P2): шаблоны, окно челленджа, дни
// выдержки, текущая серия, рейтинг и видимость.
import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_DURATION_MAX,
  CHALLENGE_KINDS,
  CHALLENGE_TEMPLATES,
  ChallengeCreateSchema,
  ChallengeCheckSchema,
  ChallengeJoinSchema,
  canViewChallenge,
  challengeCheckedToday,
  challengeCurrentStreak,
  challengeDayNumber,
  challengeEndDate,
  challengeHeldDays,
  challengeLeaderboard,
  challengeProgressPercent,
} from '../src/challenges';

const START = '2026-10-01';

describe('шаблоны челленджей', () => {
  it('содержит три шаблона из ТЗ §4 с корректными видами', () => {
    expect(CHALLENGE_TEMPLATES.map((template) => template.key)).toEqual([
      'no_delivery_30',
      'no_impulse_week',
      'streak_checkin_7',
    ]);
    expect(CHALLENGE_TEMPLATES.every((template) => CHALLENGE_KINDS.includes(template.kind))).toBe(
      true,
    );
    const streak = CHALLENGE_TEMPLATES.find((template) => template.key === 'streak_checkin_7');
    expect(streak?.kind).toBe('streak_checkin');
  });
});

describe('ChallengeCreateSchema', () => {
  it('подставляет значения по умолчанию: custom, 30 дней, private', () => {
    const parsed = ChallengeCreateSchema.parse({ title: 'Без доставки' });
    expect(parsed).toMatchObject({ kind: 'custom', durationDays: 30, visibility: 'private' });
  });

  it('ограничивает длительность разумным максимумом', () => {
    expect(ChallengeCreateSchema.safeParse({ title: 'X', durationDays: 0 }).success).toBe(false);
    expect(
      ChallengeCreateSchema.safeParse({ title: 'X', durationDays: CHALLENGE_DURATION_MAX + 1 })
        .success,
    ).toBe(false);
  });

  it('отклоняет пустое название', () => {
    expect(ChallengeCreateSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});

describe('ChallengeJoinSchema / ChallengeCheckSchema', () => {
  it('join требует код минимум из 4 символов', () => {
    expect(ChallengeJoinSchema.safeParse({ code: 'abc' }).success).toBe(false);
    expect(ChallengeJoinSchema.parse({ code: ' ch-123 ' }).code).toBe('ch-123');
  });

  it('check по умолчанию «держусь» (ok = true)', () => {
    expect(ChallengeCheckSchema.parse({}).ok).toBe(true);
    expect(ChallengeCheckSchema.parse({ ok: false }).ok).toBe(false);
  });
});

describe('окно челленджа', () => {
  it('последний день — старт + (длительность − 1)', () => {
    expect(challengeEndDate(START, 30).toISOString().slice(0, 10)).toBe('2026-10-30');
    expect(challengeEndDate(START, 1).toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('номер дня 1..duration, null вне окна', () => {
    expect(challengeDayNumber(START, 30, new Date('2026-10-01T12:00:00Z'))).toBe(1);
    expect(challengeDayNumber(START, 30, new Date('2026-10-30T12:00:00Z'))).toBe(30);
    expect(challengeDayNumber(START, 30, new Date('2026-10-31T12:00:00Z'))).toBeNull();
    expect(challengeDayNumber(START, 30, new Date('2026-09-30T12:00:00Z'))).toBeNull();
  });
});

describe('дни выдержки и серия', () => {
  it('считает уникальные ok-дни внутри окна и игнорирует провалы', () => {
    const held = challengeHeldDays(START, 7, [
      { date: '2026-10-01', ok: true },
      { date: '2026-10-02', ok: false },
      { date: '2026-10-03', ok: true },
      { date: '2026-10-03', ok: true },
      // Вне окна — не считается.
      { date: '2026-11-01', ok: true },
    ]);
    expect(held).toBe(2);
  });

  it('текущая серия считает подряд с сегодня, если сегодня отметки нет — со вчера', () => {
    const checks = [
      { date: '2026-10-05', ok: true },
      { date: '2026-10-06', ok: true },
      { date: '2026-10-07', ok: true },
    ];
    expect(challengeCurrentStreak(checks, new Date('2026-10-07T10:00:00Z'))).toBe(3);
    // Сегодня (8 октября) отметки нет — серия держится по вчерашний день.
    expect(challengeCurrentStreak(checks, new Date('2026-10-08T10:00:00Z'))).toBe(3);
    // Пропущен день 7 — серия рвётся на дне 6.
    expect(
      challengeCurrentStreak([{ date: '2026-10-06', ok: true }], new Date('2026-10-08T10:00:00Z')),
    ).toBe(0);
  });

  it('checkedToday отличает отметку сегодня', () => {
    const checks = [{ date: '2026-10-01', ok: true }];
    expect(challengeCheckedToday(checks, new Date('2026-10-01T23:00:00Z'))).toBe(true);
    expect(challengeCheckedToday(checks, new Date('2026-10-02T00:30:00Z'))).toBe(false);
  });
});

describe('прогресс в процентах', () => {
  it('округляет и зажимает в 0..100', () => {
    expect(challengeProgressPercent(3, 7)).toBe(43);
    expect(challengeProgressPercent(0, 30)).toBe(0);
    expect(challengeProgressPercent(99, 30)).toBe(100);
    expect(challengeProgressPercent(1, 0)).toBe(0);
  });
});

describe('challengeLeaderboard', () => {
  it('сортирует по дням выдержки, затем по серии и никнейму; места без пропусков', () => {
    const from = new Date('2026-10-03T10:00:00Z');
    const entries = challengeLeaderboard(
      [
        {
          userId: 'u1',
          nickname: 'boris',
          joinedAt: '2026-10-01',
          checks: [
            { date: '2026-10-01', ok: true },
            { date: '2026-10-02', ok: true },
          ],
        },
        {
          userId: 'u2',
          nickname: 'anna',
          joinedAt: '2026-10-01',
          checks: [
            { date: '2026-10-01', ok: true },
            { date: '2026-10-02', ok: true },
            { date: '2026-10-03', ok: true },
          ],
        },
        {
          userId: 'u3',
          nickname: 'vera',
          joinedAt: '2026-10-02',
          checks: [],
        },
      ],
      START,
      30,
      from,
    );
    expect(entries.map((entry) => entry.nickname)).toEqual(['anna', 'boris', 'vera']);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(entries[0]).toMatchObject({ nickname: 'anna', score: 3, currentStreak: 3 });
    expect(entries[2]).toMatchObject({ nickname: 'vera', score: 0, currentStreak: 0 });
  });

  it('при равном счёте порядок решает текущая серия, затем никнейм', () => {
    const entries = challengeLeaderboard(
      [
        {
          userId: 'u1',
          nickname: 'zeta',
          joinedAt: '2026-10-01',
          checks: [{ date: '2026-10-01', ok: true }],
        },
        {
          userId: 'u2',
          nickname: 'alpha',
          joinedAt: '2026-10-01',
          checks: [{ date: '2026-10-01', ok: true }],
        },
      ],
      START,
      30,
      new Date('2026-10-05T10:00:00Z'),
    );
    expect(entries.map((entry) => entry.nickname)).toEqual(['alpha', 'zeta']);
  });
});

describe('canViewChallenge', () => {
  it('участник видит всегда', () => {
    expect(canViewChallenge('private', true, false)).toBe(true);
  });

  it('private — только участник', () => {
    expect(canViewChallenge('private', false, true)).toBe(false);
  });

  it('friends — подписчики владельца', () => {
    expect(canViewChallenge('friends', false, true)).toBe(true);
    expect(canViewChallenge('friends', false, false)).toBe(false);
  });

  it('public — все авторизованные', () => {
    expect(canViewChallenge('public', false, false)).toBe(true);
  });
});
