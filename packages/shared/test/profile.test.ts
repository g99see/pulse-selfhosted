// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты чистой логики публичного профиля (ТЗ §3.7): видимость карточек,
// режим «проценты/сумма» и очистка HTML.
import { describe, expect, it } from 'vitest';
import {
  canViewCard,
  canViewProfile,
  cardTypeSupportsAmount,
  filterVisibleCards,
  resolveCardMode,
  sanitizeCardHtml,
} from '../src/profile';

describe('видимость карточки (ТЗ §3.7)', () => {
  it('public видят все, включая анонимного смотрящего', () => {
    expect(canViewCard('public', {})).toBe(true);
    expect(canViewCard('public', { isSubscriber: false })).toBe(true);
  });

  it('subscribers — только подписчики и владелец', () => {
    expect(canViewCard('subscribers', {})).toBe(false);
    expect(canViewCard('subscribers', { isSubscriber: false })).toBe(false);
    expect(canViewCard('subscribers', { isSubscriber: true })).toBe(true);
    expect(canViewCard('subscribers', { isOwner: true })).toBe(true);
  });

  it('private не отдаётся никому, кроме владельца', () => {
    expect(canViewCard('private', {})).toBe(false);
    expect(canViewCard('private', { isSubscriber: true })).toBe(false);
    expect(canViewCard('private', { isOwner: true })).toBe(true);
  });
});

describe('видимость самого профиля', () => {
  it('private виден только владельцу, subscribers — подписчику', () => {
    expect(canViewProfile('private', { isSubscriber: true })).toBe(false);
    expect(canViewProfile('private', {})).toBe(false);
    expect(canViewProfile('private', { isOwner: true })).toBe(true);
    expect(canViewProfile('subscribers', { isSubscriber: true })).toBe(true);
    expect(canViewProfile('subscribers', {})).toBe(false);
    expect(canViewProfile('public', {})).toBe(true);
  });
});

describe('filterVisibleCards', () => {
  const cards = [
    { type: 'savings', visibility: 'public' as const },
    { type: 'goals', visibility: 'subscribers' as const },
    { type: 'avg_mood', visibility: 'private' as const },
  ];

  it('анонимный видит только public', () => {
    expect(filterVisibleCards(cards, {}).map((card) => card.type)).toEqual(['savings']);
  });

  it('подписчик видит public и subscribers, но не private', () => {
    expect(filterVisibleCards(cards, { isSubscriber: true }).map((card) => card.type)).toEqual([
      'savings',
      'goals',
    ]);
  });

  it('владелец видит все карточки', () => {
    expect(filterVisibleCards(cards, { isOwner: true }).map((card) => card.type)).toEqual([
      'savings',
      'goals',
      'avg_mood',
    ]);
  });
});

describe('режим отображения: проценты по умолчанию, суммы только там, где осмысленны', () => {
  it('сумма поддерживается лишь накоплениями и целями', () => {
    expect(cardTypeSupportsAmount('savings')).toBe(true);
    expect(cardTypeSupportsAmount('goals')).toBe(true);
    expect(cardTypeSupportsAmount('checkin_streak')).toBe(false);
    expect(cardTypeSupportsAmount('avg_mood')).toBe(false);
    expect(cardTypeSupportsAmount('achievements')).toBe(false);
    expect(cardTypeSupportsAmount('html_page')).toBe(false);
  });

  it('amount у неподдерживаемого типа схлопывается в percent', () => {
    expect(resolveCardMode('savings', 'amount')).toBe('amount');
    expect(resolveCardMode('checkin_streak', 'amount')).toBe('percent');
    expect(resolveCardMode('avg_mood', 'amount')).toBe('percent');
  });
});

describe('sanitizeCardHtml (ТЗ §3.8)', () => {
  it('удаляет script и обработчики on*', () => {
    const dirty = '<p onclick="steal()">Привет</p><script>alert(1)</script>';
    const clean = sanitizeCardHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).toContain('Привет');
  });

  it('удаляет iframe, style и javascript:', () => {
    const dirty =
      '<style>body{}</style><iframe src="x"></iframe><a href="javascript:alert(1)">x</a>';
    const clean = sanitizeCardHtml(dirty);
    expect(clean).not.toContain('<style');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('javascript:');
  });
});
