// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты генератора карточки «Поделиться» (ТЗ §3.7, сценарий 2):
// проценты на месте, суммы скрыты по умолчанию, формат задаёт размеры,
// пользовательский текст экранируется, подписи — ru/en.
import { describe, expect, it } from 'vitest';
import {
  SHARE_CARD_SIZES,
  ShareCardQuerySchema,
  achievementEmoji,
  escapeXml,
  isShareAchievementCode,
  renderShareCard,
  shareAchievementTitle,
  type ShareCardData,
} from '../src/share-card';

const goal: ShareCardData = {
  type: 'goal_progress',
  title: 'Ноутбук',
  percent: 50,
  savedAmount: 60000,
  targetAmount: 120000,
  currency: 'RUB',
};

const streak: ShareCardData = {
  type: 'checkin_streak',
  current: 12,
  longest: 20,
  checkedToday: true,
};

const achievement: ShareCardData = {
  type: 'achievement',
  code: 'goal_half',
  earnedAt: '2026-10-01T10:00:00.000Z',
};

const mood: ShareCardData = { type: 'avg_mood', average: 4.2, checkins: 18, month: '2026-10' };

describe('escapeXml', () => {
  it('экранирует спецсимволы XML', () => {
    expect(escapeXml('<a & "b" \'c\'>')).toBe('&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');
  });
});

describe('renderShareCard', () => {
  it('карточка цели содержит процент и название', () => {
    const svg = renderShareCard(goal, { format: 'story' });
    expect(svg).toContain('50%');
    expect(svg).toContain('Ноутбук');
    expect(svg).toContain('<svg');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('форматы задают размеры story 1080×1920 и square 1080×1080', () => {
    const story = renderShareCard(goal, { format: 'story' });
    expect(story).toContain(`width="${SHARE_CARD_SIZES.story.width}"`);
    expect(story).toContain(`height="${SHARE_CARD_SIZES.story.height}"`);

    const square = renderShareCard(goal, { format: 'square' });
    expect(square).toContain(`width="${SHARE_CARD_SIZES.square.width}"`);
    expect(square).toContain(`height="${SHARE_CARD_SIZES.square.height}"`);
  });

  it('по умолчанию суммы скрыты, показывается только процент (ТЗ §3.7)', () => {
    const svg = renderShareCard(goal, { format: 'story' });
    expect(svg).toContain('50%');
    expect(svg).not.toContain('Накоплено');
    expect(svg).not.toContain('60000');
    expect(svg).not.toContain('60 000');
    expect(svg).not.toContain('120 000');
  });

  it('при showAmounts показывает накопленное и цель', () => {
    const svg = renderShareCard(goal, { format: 'story', showAmounts: true });
    expect(svg).toContain('Накоплено');
    expect(svg).toContain('Цель');
    expect(svg.replace(/\u00a0/g, ' ')).toContain('60 000');
  });

  it('экранирует пользовательское название и не пропускает разметку', () => {
    const svg = renderShareCard(
      { ...goal, title: '<script>alert(1)</script>' },
      { format: 'square' },
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('подписи переключаются локалью ru/en', () => {
    const ru = renderShareCard(goal, { locale: 'ru' });
    expect(ru).toContain('Прогресс цели');
    const en = renderShareCard(goal, { locale: 'en' });
    expect(en).toContain('Goal progress');
    expect(en).not.toContain('Прогресс цели');
  });

  it('карточка стрика содержит число дней', () => {
    const svg = renderShareCard(streak, { format: 'square' });
    expect(svg).toContain('>12<');
    expect(svg).toContain('дней подряд');
  });

  it('карточка достижения содержит эмодзи и название бейджа', () => {
    const svg = renderShareCard(achievement, { format: 'story', locale: 'ru' });
    expect(svg).toContain('⛰️');
    expect(svg).toContain('Половина пути');
    expect(svg).toContain('2026-10-01');
  });

  it('карточка настроения форматирует среднее по локали и умеет пустое значение', () => {
    expect(renderShareCard(mood, { locale: 'ru', format: 'square' })).toContain('4,2');
    expect(renderShareCard(mood, { locale: 'en', format: 'square' })).toContain('4.2');
    const empty = renderShareCard({ ...mood, average: null }, { format: 'square' });
    expect(empty).toContain('Пока нет данных');
  });

  it('тёмная тема меняет фон', () => {
    const light = renderShareCard(goal, { theme: 'light' });
    const dark = renderShareCard(goal, { theme: 'dark' });
    expect(light).toContain('#FAF8F5');
    expect(dark).toContain('#14141A');
  });
});

describe('ShareCardQuerySchema', () => {
  it('по умолчанию story, ru и без сумм', () => {
    const parsed = ShareCardQuerySchema.parse({ type: 'goal_progress' });
    expect(parsed).toMatchObject({
      type: 'goal_progress',
      format: 'story',
      locale: 'ru',
      amounts: 0,
    });
  });

  it('принимает amounts=1 и отклоняет неизвестный тип', () => {
    expect(ShareCardQuerySchema.parse({ type: 'avg_mood', amounts: '1' }).amounts).toBe(1);
    expect(ShareCardQuerySchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

describe('подписи достижений', () => {
  it('распознаёт коды и отдаёт название по локали', () => {
    expect(isShareAchievementCode('goal_half')).toBe(true);
    expect(isShareAchievementCode('nope')).toBe(false);
    expect(shareAchievementTitle('goal_half', 'ru')).toBe('Половина пути');
    expect(shareAchievementTitle('goal_half', 'en')).toBe('Halfway there');
    expect(shareAchievementTitle('nope', 'ru')).toBe('nope');
  });

  it('эмодзи бейджа с запасным вариантом', () => {
    expect(achievementEmoji('goal_complete')).toBe('🏆');
    expect(achievementEmoji('unknown')).toBe('⭐');
  });
});
