// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты извлечения тегов из голосовой заметки (ТЗ §4, P2): словарь ru/en,
// префиксный поиск по основам, отсутствие ложных срабатываний и дедупликация.
import { describe, expect, it } from 'vitest';
import { extractVoiceTags, VOICE_TAG_RULES } from '../src/voice-tags';

describe('extractVoiceTags', () => {
  it('находит теги в русском тексте', () => {
    expect(extractVoiceTags('Сегодня был спорт и хорошо выспался')).toEqual(['спорт', 'сон']);
  });

  it('находит теги в английском тексте', () => {
    expect(extractVoiceTags('went to the gym and slept well')).toEqual(['спорт', 'сон']);
  });

  it('ловит формы слов по основе: «тренируюсь», «работал»', () => {
    expect(extractVoiceTags('Работал над проектом и тренируюсь вечером')).toEqual([
      'работа',
      'спорт',
    ]);
  });

  it('возвращает теги в порядке словаря и без повторов', () => {
    expect(extractVoiceTags('спорт, спорт, сон и снова спорт')).toEqual(['спорт', 'сон']);
  });

  it('не ловит ключевое слово в середине другого слова', () => {
    // «персон» содержит «сон», но не с начала слова — тег не предлагается.
    expect(extractVoiceTags('Обсуждали персон из новостей')).toEqual([]);
    // «brunch» содержит «run» не с начала слова.
    expect(extractVoiceTags('had a brunch with friends')).toEqual(['друзья']);
  });

  it('различает болезнь и здоровье', () => {
    expect(extractVoiceTags('Заболел и лежу с температурой')).toEqual(['болею']);
  });

  it('находит несколько разных тегов', () => {
    expect(extractVoiceTags('Поругался с женой из-за учёбы сына')).toEqual([
      'семья',
      'учёба',
      'ссора',
    ]);
  });

  it('на английском различает еду и друзей по порядку словаря', () => {
    expect(extractVoiceTags('had lunch and met friends')).toEqual(['еда', 'друзья']);
  });

  it('на пустом и нестроковом входе возвращает пусто', () => {
    expect(extractVoiceTags('')).toEqual([]);
    expect(extractVoiceTags('   ')).toEqual([]);
    expect(extractVoiceTags(undefined as unknown as string)).toEqual([]);
  });

  it('словарь не пуст, а теги уникальны', () => {
    expect(VOICE_TAG_RULES.length).toBeGreaterThan(0);
    const tags = VOICE_TAG_RULES.map((rule) => rule.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const rule of VOICE_TAG_RULES) {
      expect(rule.keywords.length).toBeGreaterThan(0);
    }
  });
});
