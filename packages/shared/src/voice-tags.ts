// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Теги из голосового чек-ина (ТЗ §4, P2): «надиктовать, как прошёл день;
 * сервис расшифрует и выделит теги». Распознавание речи идёт целиком на
 * клиенте (Web Speech API) — сюда приходит уже готовый текст, поэтому модуль
 * остаётся чистой функцией без сети и побочных эффектов.
 *
 * Словарь ключевых слов ru/en сопоставляется с существующими тегами чек-инов
 * (спорт, сон, работа, семья, друзья, еда, учёба, здоровье и т.п.).
 * Схему чек-ина это не меняет: тег — свободная строка до 64 символов.
 */

/** Правило словаря: канонический тег и его ключевые слова (ru/en). */
export interface VoiceTagRule {
  tag: string;
  keywords: readonly string[];
}

/**
 * Словарь «ключевое слово → тег». Порядок правил задаёт порядок предложенных
 * тегов. Слова сверяются с началом слова (см. matchesTag), поэтому основы вроде
 * «работ», «трениров» ловят формы «работаю», «тренировка».
 */
export const VOICE_TAG_RULES: readonly VoiceTagRule[] = [
  {
    tag: 'работа',
    keywords: ['работ', 'созвон', 'дедлайн', 'проект', 'офис', 'коллег', 'задач', 'work', 'job', 'deadline', 'office', 'meeting', 'project'],
  },
  {
    tag: 'спорт',
    keywords: ['спорт', 'тренир', 'зал', 'бег', 'пробеж', 'йог', 'футбол', 'велик', 'велосипед', 'плава', 'sport', 'workout', 'gym', 'run', 'jog', 'yoga', 'football', 'bike', 'swim'],
  },
  {
    tag: 'сон',
    keywords: ['сон', 'спал', 'спала', 'выспал', 'недосып', 'поспал', 'sleep', 'slept', 'nap', 'insomnia'],
  },
  {
    tag: 'еда',
    keywords: ['еда', 'поел', 'обед', 'ужин', 'завтрак', 'готовил', 'кафе', 'ресторан', 'food', 'lunch', 'dinner', 'breakfast', 'cafe', 'meal'],
  },
  {
    tag: 'семья',
    keywords: ['семь', 'мам', 'пап', 'родител', 'ребён', 'ребен', 'дет', 'жен', 'муж', 'family', 'mom', 'dad', 'parent', 'kid', 'child', 'wife', 'husband'],
  },
  {
    tag: 'друзья',
    keywords: ['друз', 'подруг', 'встретил', 'friend'],
  },
  {
    tag: 'учёба',
    keywords: ['учёб', 'учеб', 'учил', 'экзамен', 'курс', 'лекц', 'study', 'exam', 'course', 'school', 'learn'],
  },
  {
    tag: 'здоровье',
    keywords: ['здоров', 'врач', 'аптек', 'больниц', 'health', 'doctor', 'hospital', 'medicine'],
  },
  {
    tag: 'болею',
    keywords: ['болею', 'болел', 'болезн', 'простуда', 'заболел', 'температур', 'sick', 'ill'],
  },
  {
    tag: 'ссора',
    keywords: ['ссор', 'поругал', 'конфликт', 'скандал', 'fight', 'argument', 'quarrel'],
  },
];

/** «ё» и «е» считаем одной буквой — люди пишут и так, и так. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ключевое слово найдено с начала слова: «сон» — да, «персон» — нет.
 * Начало слова (а не строгие границы) сохраняет префиксный поиск по основам,
 * поэтому «тренировка», «тренируюсь» совпадают с «трениров».
 */
function matchesTagKeyword(text: string, keyword: string): boolean {
  const needle = escapeRegExp(normalize(keyword));
  if (needle.length === 0) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${needle}`, 'iu').test(text);
}

/**
 * Извлекает теги из распознанного текста (ТЗ §4, P2). Возвращает уникальные
 * канонические теги в порядке словаря; пусто — если совпадений нет.
 * Предлагает только сами теги: подтверждает их пользователь в интерфейсе.
 */
export function extractVoiceTags(text: string): string[] {
  if (typeof text !== 'string') return [];
  const normalized = normalize(text);
  if (normalized.trim().length === 0) return [];

  const tags: string[] = [];
  for (const rule of VOICE_TAG_RULES) {
    if (tags.includes(rule.tag)) continue;
    if (rule.keywords.some((keyword) => matchesTagKeyword(normalized, keyword))) {
      tags.push(rule.tag);
    }
  }
  return tags;
}
