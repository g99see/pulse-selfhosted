// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Стандартные категории и подкатегории (ТЗ v2 §8).
 *
 * У каждой стандартной категории стабильный `key` (не меняется между версиями и
 * языками) и стабильный `id` строки в БД. Названия хранятся на двух языках;
 * в интерфейсе их показывает i18n по id (`finance.category.system.<id>`), а в БД
 * лежит русское название — для старых данных и текстового поиска.
 *
 * Стандартные категории общие для всех пользователей (user_id = NULL): новые
 * ключи «выдаются» всем автоматически, без дублей строк на каждого пользователя.
 */
import type { CategoryKind } from './finance';

export interface StandardCategory {
  /** Стабильный ключ: используется справочником магазинов и миграцией. */
  key: string;
  /** Стабильный id строки в БД. */
  id: string;
  /** Ключ родителя (для подкатегорий). */
  parent?: string;
  name: string;
  nameEn: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  /** Слова, по которым категорию находят в /spent и быстром вводе. */
  aliases: readonly string[];
}

/** Короткая запись: [key, id|null, parent|null, ru, en, icon, color, kind, aliases]. */
type Row = readonly [
  string,
  string | null,
  string | null,
  string,
  string,
  string,
  string,
  CategoryKind,
  readonly string[],
];

const GREEN = '#2BA889';
const INDIGO = '#5B5BD6';
const ORANGE = '#F2A25C';
const GRAY = '#6E6E7A';
const TEAL = '#3DD6AE';
const LAVENDER = '#8B8BF5';
const ROSE = '#D9638C';
const E = 'expense' as const;
const I = 'income' as const;

const ROWS: readonly Row[] = [
  // Расходы — верхний уровень. Порядок = порядок показа.
  ['food', 'sys-food', null, 'Еда', 'Food', 'utensils', GREEN, E, ['еда', 'food', 'питание']],
  [
    'groceries',
    null,
    null,
    'Продукты',
    'Groceries',
    'shopping-cart',
    GREEN,
    E,
    ['продукты', 'супермаркет', 'магазин продуктов', 'groceries', 'grocery', 'supermarket'],
  ],
  [
    'cafe',
    null,
    null,
    'Кафе и рестораны',
    'Cafes & restaurants',
    'coffee',
    ORANGE,
    E,
    [
      'кафе',
      'ресторан',
      'кофе',
      'обед',
      'завтрак',
      'ужин',
      'перекус',
      'бар',
      'cafe',
      'coffee',
      'restaurant',
      'lunch',
      'dinner',
      'breakfast',
      'bar',
    ],
  ],
  [
    'transport',
    'sys-transport',
    null,
    'Транспорт',
    'Transport',
    'bus',
    INDIGO,
    E,
    ['транспорт', 'проезд', 'transport', 'commute'],
  ],
  [
    'taxi',
    null,
    null,
    'Такси',
    'Taxi',
    'car',
    INDIGO,
    E,
    ['такси', 'uber', 'bolt', 'taxi', 'каршеринг', 'самокат', 'scooter'],
  ],
  [
    'housing',
    'sys-housing',
    null,
    'Жильё',
    'Housing',
    'house',
    ORANGE,
    E,
    ['жильё', 'жилье', 'аренда', 'квартира', 'ипотека', 'rent', 'housing', 'mortgage'],
  ],
  [
    'utilities',
    null,
    null,
    'Коммунальные',
    'Utilities',
    'zap',
    ORANGE,
    E,
    ['коммунальные', 'коммуналка', 'коммунал', 'свет', 'вода', 'газ', 'отопление', 'utilities'],
  ],
  [
    'connectivity',
    'sys-connectivity',
    null,
    'Связь и интернет',
    'Phone & internet',
    'smartphone',
    GRAY,
    E,
    ['связь', 'интернет', 'мобильная связь', 'тариф', 'sim', 'phone', 'internet', 'mobile'],
  ],
  [
    'health',
    'sys-health',
    null,
    'Здоровье',
    'Health',
    'heart-pulse',
    ROSE,
    E,
    ['здоровье', 'врач', 'стоматолог', 'больница', 'анализы', 'doctor', 'dentist', 'health'],
  ],
  [
    'pharmacy',
    null,
    null,
    'Аптека',
    'Pharmacy',
    'pill',
    ROSE,
    E,
    ['аптека', 'лекарства', 'лекарство', 'pharmacy', 'medicine'],
  ],
  [
    'sport',
    null,
    null,
    'Спорт',
    'Sports',
    'dumbbell',
    TEAL,
    E,
    ['спорт', 'зал', 'фитнес', 'тренировка', 'бассейн', 'gym', 'fitness', 'sport'],
  ],
  [
    'beauty',
    null,
    null,
    'Красота',
    'Beauty',
    'sparkles',
    ROSE,
    E,
    ['красота', 'парикмахер', 'барбер', 'маникюр', 'салон', 'косметика', 'beauty', 'haircut'],
  ],
  [
    'clothes',
    null,
    null,
    'Одежда',
    'Clothes',
    'shirt',
    LAVENDER,
    E,
    ['одежда', 'обувь', 'clothes', 'clothing', 'shoes'],
  ],
  [
    'electronics',
    null,
    null,
    'Электроника',
    'Electronics',
    'laptop',
    LAVENDER,
    E,
    ['электроника', 'техника', 'гаджет', 'электронику', 'electronics', 'gadget'],
  ],
  [
    'subscriptions',
    'sys-subscriptions',
    null,
    'Подписки',
    'Subscriptions',
    'repeat',
    INDIGO,
    E,
    ['подписка', 'подписки', 'netflix', 'spotify', 'icloud', 'subscription'],
  ],
  [
    'entertainment',
    'sys-entertainment',
    null,
    'Развлечения',
    'Entertainment',
    'party-popper',
    ROSE,
    E,
    ['развлечения', 'кино', 'концерт', 'театр', 'игра', 'entertainment', 'cinema', 'fun'],
  ],
  [
    'travel',
    null,
    null,
    'Путешествия',
    'Travel',
    'plane',
    TEAL,
    E,
    ['путешествия', 'путешествие', 'поездка', 'отпуск', 'отель', 'билеты', 'travel', 'trip'],
  ],
  [
    'education',
    null,
    null,
    'Образование',
    'Education',
    'book',
    INDIGO,
    E,
    ['образование', 'учёба', 'учеба', 'курсы', 'книги', 'education', 'course', 'books'],
  ],
  [
    'gifts',
    null,
    null,
    'Подарки',
    'Gifts',
    'gift',
    ROSE,
    E,
    ['подарки', 'подарок', 'цветы', 'gift', 'gifts', 'present'],
  ],
  [
    'kids',
    null,
    null,
    'Дети',
    'Kids',
    'baby',
    ORANGE,
    E,
    ['дети', 'ребёнок', 'ребенок', 'детский сад', 'игрушки', 'kids', 'children', 'baby'],
  ],
  [
    'pets',
    null,
    null,
    'Питомцы',
    'Pets',
    'paw-print',
    ORANGE,
    E,
    ['питомцы', 'питомец', 'ветеринар', 'корм', 'pets', 'pet', 'vet'],
  ],
  [
    'taxes_fees',
    null,
    null,
    'Налоги и комиссии',
    'Taxes & fees',
    'receipt',
    GRAY,
    E,
    ['налог', 'налоги', 'комиссия', 'комиссии', 'штраф', 'tax', 'taxes', 'fee', 'fees', 'fine'],
  ],
  [
    'transfers',
    null,
    null,
    'Переводы',
    'Transfers',
    'arrow-left-right',
    GRAY,
    E,
    ['перевод', 'переводы', 'transfer', 'transfers', 'mobilepay', 'swish', 'vipps'],
  ],
  [
    'cash',
    null,
    null,
    'Наличные',
    'Cash',
    'wallet',
    GRAY,
    E,
    ['наличные', 'снятие', 'банкомат', 'cash', 'atm', 'withdrawal'],
  ],
  [
    'savings',
    null,
    null,
    'Накопления',
    'Savings',
    'piggy-bank',
    GREEN,
    E,
    ['накопления', 'копилка', 'сбережения', 'savings', 'save'],
  ],
  [
    'shopping',
    'sys-shopping',
    null,
    'Покупки',
    'Shopping',
    'shopping-bag',
    LAVENDER,
    E,
    ['покупки', 'покупка', 'магазин', 'shopping', 'purchase'],
  ],
  [
    'other',
    'sys-other',
    null,
    'Прочее',
    'Other',
    'circle-ellipsis',
    GRAY,
    E,
    ['прочее', 'другое', 'other', 'misc'],
  ],

  // Подкатегории расходов.
  [
    'groceries_delivery',
    null,
    'groceries',
    'Доставка продуктов',
    'Grocery delivery',
    'truck',
    GREEN,
    E,
    ['доставка продуктов', 'grocery delivery'],
  ],
  [
    'restaurants',
    null,
    'cafe',
    'Рестораны',
    'Restaurants',
    'utensils',
    ORANGE,
    E,
    ['рестораны', 'restaurants'],
  ],
  [
    'coffee',
    null,
    'cafe',
    'Кофейни',
    'Coffee shops',
    'coffee',
    ORANGE,
    E,
    ['кофейня', 'кофейни', 'coffee shop'],
  ],
  [
    'fast_food',
    null,
    'cafe',
    'Фастфуд',
    'Fast food',
    'sandwich',
    ORANGE,
    E,
    ['фастфуд', 'fast food', 'fastfood', 'бургер', 'burger', 'pizza', 'пицца'],
  ],
  [
    'food_delivery',
    null,
    'cafe',
    'Доставка еды',
    'Food delivery',
    'truck',
    ORANGE,
    E,
    ['доставка еды', 'доставка', 'food delivery', 'delivery'],
  ],
  [
    'bars',
    null,
    'cafe',
    'Бары',
    'Bars & pubs',
    'beer',
    ORANGE,
    E,
    ['пиво', 'паб', 'beer', 'pub', 'bars'],
  ],
  [
    'public_transport',
    null,
    'transport',
    'Общественный транспорт',
    'Public transport',
    'train',
    INDIGO,
    E,
    ['метро', 'автобус', 'трамвай', 'электричка', 'metro', 'bus', 'train', 'public transport'],
  ],
  [
    'fuel',
    null,
    'transport',
    'Бензин',
    'Fuel',
    'fuel',
    INDIGO,
    E,
    ['бензин', 'заправка', 'азс', 'топливо', 'fuel', 'gas', 'petrol'],
  ],
  [
    'parking',
    null,
    'transport',
    'Парковка',
    'Parking',
    'parking',
    INDIGO,
    E,
    ['парковка', 'parking'],
  ],
  [
    'car',
    null,
    'transport',
    'Авто',
    'Car',
    'car',
    INDIGO,
    E,
    ['авто', 'машина', 'сто', 'шиномонтаж', 'car', 'car service'],
  ],
  [
    'bike_scooter',
    null,
    'transport',
    'Велосипед и самокат',
    'Bike & scooter',
    'bike',
    INDIGO,
    E,
    ['велосипед', 'bike', 'e-scooter'],
  ],
  ['rent', null, 'housing', 'Аренда', 'Rent', 'house', ORANGE, E, ['аренда жилья', 'rent']],
  [
    'home_goods',
    null,
    'housing',
    'Дом и ремонт',
    'Home & repair',
    'hammer',
    ORANGE,
    E,
    ['ремонт', 'мебель', 'для дома', 'home', 'furniture', 'repair', 'diy'],
  ],
  [
    'electricity',
    null,
    'utilities',
    'Электричество',
    'Electricity',
    'zap',
    ORANGE,
    E,
    ['электричество', 'electricity'],
  ],
  [
    'water_heating',
    null,
    'utilities',
    'Вода и отопление',
    'Water & heating',
    'droplet',
    ORANGE,
    E,
    ['водоснабжение', 'water', 'heating'],
  ],
  [
    'mobile',
    null,
    'connectivity',
    'Мобильная связь',
    'Mobile',
    'smartphone',
    GRAY,
    E,
    ['сотовая связь', 'мобильный', 'mobile plan'],
  ],
  [
    'home_internet',
    null,
    'connectivity',
    'Домашний интернет',
    'Home internet',
    'wifi',
    GRAY,
    E,
    ['домашний интернет', 'wifi', 'broadband'],
  ],
  [
    'doctors',
    null,
    'health',
    'Врачи и анализы',
    'Doctors & tests',
    'stethoscope',
    ROSE,
    E,
    ['врачи', 'клиника', 'clinic'],
  ],
  [
    'dentist',
    null,
    'health',
    'Стоматология',
    'Dental',
    'smile',
    ROSE,
    E,
    ['стоматология', 'зубы', 'dental'],
  ],
  [
    'gym',
    null,
    'sport',
    'Залы и абонементы',
    'Gyms & memberships',
    'dumbbell',
    TEAL,
    E,
    ['абонемент', 'membership'],
  ],
  [
    'sport_goods',
    null,
    'sport',
    'Спорттовары',
    'Sports goods',
    'bike',
    TEAL,
    E,
    ['спорттовары', 'sports goods'],
  ],
  [
    'hairdresser',
    null,
    'beauty',
    'Парикмахерская',
    'Hairdresser',
    'scissors',
    ROSE,
    E,
    ['стрижка', 'hairdresser', 'barber'],
  ],
  [
    'cosmetics',
    null,
    'beauty',
    'Косметика',
    'Cosmetics',
    'sparkles',
    ROSE,
    E,
    ['cosmetics', 'makeup', 'drugstore'],
  ],
  [
    'music_video',
    null,
    'subscriptions',
    'Музыка и видео',
    'Music & video',
    'play',
    INDIGO,
    E,
    ['музыка', 'видео', 'music', 'streaming', 'video'],
  ],
  [
    'software',
    null,
    'subscriptions',
    'Сервисы и софт',
    'Software & cloud',
    'cloud',
    INDIGO,
    E,
    ['софт', 'облако', 'хостинг', 'software', 'cloud', 'hosting', 'saas'],
  ],
  [
    'games',
    null,
    'entertainment',
    'Игры',
    'Games',
    'gamepad',
    ROSE,
    E,
    ['игры', 'steam', 'games', 'gaming'],
  ],
  [
    'cinema_events',
    null,
    'entertainment',
    'Кино и события',
    'Cinema & events',
    'ticket',
    ROSE,
    E,
    ['билет', 'ticket', 'events'],
  ],
  [
    'flights',
    null,
    'travel',
    'Авиабилеты',
    'Flights',
    'plane',
    TEAL,
    E,
    ['авиабилеты', 'самолёт', 'самолет', 'flight', 'flights', 'airline'],
  ],
  [
    'hotels',
    null,
    'travel',
    'Жильё в поездках',
    'Hotels & stays',
    'bed',
    TEAL,
    E,
    ['гостиница', 'хостел', 'hotel', 'hostel', 'airbnb'],
  ],
  [
    'intercity',
    null,
    'travel',
    'Междугородний транспорт',
    'Intercity transport',
    'train',
    TEAL,
    E,
    ['поезд', 'междугородний', 'intercity', 'ferry', 'паром'],
  ],
  [
    'clothes_shoes',
    null,
    'clothes',
    'Обувь',
    'Shoes',
    'shirt',
    LAVENDER,
    E,
    ['обувь', 'ботинки', 'кроссовки', 'shoes', 'sneakers'],
  ],
  [
    'marketplace',
    null,
    'shopping',
    'Маркетплейсы',
    'Marketplaces',
    'shopping-bag',
    LAVENDER,
    E,
    ['маркетплейс', 'marketplace', 'ozon', 'wildberries', 'amazon'],
  ],
  [
    'bank_fees',
    null,
    'taxes_fees',
    'Комиссии банка',
    'Bank fees',
    'receipt',
    GRAY,
    E,
    ['комиссия банка', 'bank fee'],
  ],

  // Доходы.
  [
    'salary',
    'sys-salary',
    null,
    'Зарплата',
    'Salary',
    'banknote',
    GREEN,
    I,
    ['зарплата', 'аванс', 'оклад', 'получка', 'salary', 'wage', 'payroll'],
  ],
  [
    'refunds',
    null,
    null,
    'Возвраты',
    'Refunds',
    'undo',
    GREEN,
    I,
    ['возврат', 'возвраты', 'кэшбэк', 'кэшбек', 'refund', 'refunds', 'cashback'],
  ],
  [
    'other_income',
    'sys-other-income',
    null,
    'Прочий доход',
    'Other income',
    'plus',
    GREEN,
    I,
    ['доход', 'премия', 'подработка', 'income', 'bonus', 'freelance'],
  ],
];

export const STANDARD_CATEGORIES: readonly StandardCategory[] = ROWS.map(
  ([key, id, parent, name, nameEn, icon, color, kind, aliases]) => ({
    key,
    id: id ?? `sys-${key.replace(/_/g, '-')}`,
    ...(parent ? { parent } : {}),
    name,
    nameEn,
    icon,
    color,
    kind,
    aliases,
  }),
);

const BY_KEY: ReadonlyMap<string, StandardCategory> = new Map(
  STANDARD_CATEGORIES.map((category) => [category.key, category]),
);

export function standardCategory(key: string): StandardCategory | undefined {
  return BY_KEY.get(key);
}

export function isStandardCategoryKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** Стабильный id строки БД по ключу (или null для неизвестного ключа). */
export function standardCategoryId(key: string): string | null {
  return BY_KEY.get(key)?.id ?? null;
}

/** Сколько верхних категорий и подкатегорий в стандартном наборе. */
export function standardCategoryCounts(): { top: number; sub: number; total: number } {
  const sub = STANDARD_CATEGORIES.filter((category) => category.parent).length;
  return { top: STANDARD_CATEGORIES.length - sub, sub, total: STANDARD_CATEGORIES.length };
}

/** Для обратной совместимости: плоский список прежнего вида (name/icon/color/kind). */
export const SYSTEM_CATEGORIES: readonly {
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
}[] = STANDARD_CATEGORIES.map(({ name, icon, color, kind }) => ({ name, icon, color, kind }));

/* ----- Поиск категории по тексту (быстрый ввод, /spent) ----- */

/** Минимум полей категории, нужный для поиска по имени и алиасу. */
export interface CategoryMatchSource {
  id: string;
  name: string;
  kind: CategoryKind;
  key?: string | null;
  isSystem?: boolean;
}

function normalizeWord(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Находит категорию по тексту: в приоритете свои категории (по точному имени),
 * затем алиасы и названия стандартных (ru/en). Сопоставление — по целым словам
 * текста, поэтому «такси домой» → «Такси», а «такси» не цепляет «Таксидермия».
 * @returns id найденной категории или null.
 */
export function matchCategoryByText(
  text: string,
  categories: readonly CategoryMatchSource[],
  kind?: CategoryKind,
): string | null {
  const normalized = normalizeWord(text);
  if (normalized === '') return null;
  const padded = ` ${normalized.replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ')} `;
  const has = (phrase: string): boolean => padded.includes(` ${normalizeWord(phrase)} `);

  const pool = kind ? categories.filter((category) => category.kind === kind) : categories;

  // 1. Своя категория: имя целиком встречается в тексте (самое длинное — приоритетнее).
  const own = pool
    .filter((category) => category.isSystem === false && has(category.name))
    .sort((a, b) => b.name.length - a.name.length);
  if (own.length > 0) return own[0].id;

  // 2. Стандартные: алиасы и названия; самая длинная фраза выигрывает.
  let best: { id: string; length: number } | null = null;
  for (const category of pool) {
    if (category.isSystem === false) continue;
    const standard = category.key ? BY_KEY.get(category.key) : undefined;
    if (!standard) continue;
    for (const phrase of [...standard.aliases, standard.name, standard.nameEn]) {
      if (has(phrase) && (!best || phrase.length > best.length)) {
        best = { id: category.id, length: phrase.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Порядок показа: верхний уровень в порядке набора, свои — по алфавиту,
 * подкатегории сразу под родителем. Возвращает плоский список с глубиной.
 */
export function orderCategoryTree<
  T extends { id: string; parentId?: string | null; name: string; isSystem: boolean },
>(categories: readonly T[]): Array<T & { depth: 0 | 1 }> {
  const known = new Set(categories.map((category) => category.id));
  const children = new Map<string, T[]>();
  const top: T[] = [];
  for (const category of categories) {
    if (category.parentId && known.has(category.parentId)) {
      children.set(category.parentId, [...(children.get(category.parentId) ?? []), category]);
    } else {
      top.push(category);
    }
  }
  const result: Array<T & { depth: 0 | 1 }> = [];
  for (const parent of top) {
    result.push({ ...parent, depth: 0 });
    for (const child of children.get(parent.id) ?? []) result.push({ ...child, depth: 1 });
  }
  return result;
}
