// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Инсайты и рекомендации на правилах (ТЗ §3.5). Чистые функции: считают
 * кандидатов по данным пользователя (траты, энергия, настроение, бюджеты),
 * отбирают недельный разбор «3 инсайта + 1 предложение», учитывают оценки
 * «полезно / не полезно» и описывают справочник служб поддержки по стране.
 *
 * Никаких медицинских диагнозов: формулировки — это подсказки о привычках,
 * а в тревожном случае сервис мягко предлагает обратиться за поддержкой.
 */
import { z } from 'zod';
import { percentChange } from './dates';
import { localParts } from './notifications';
import { roundMoney, type CategorySpend } from './stats';

/* ----- Типы инсайтов и оценки ----- */

export const INSIGHT_TYPES = [
  'category_spend_up',
  'low_energy_streak',
  'mood_with_sport',
  'budget_exceeded',
  'budget_suggestion',
  'wellbeing_concern',
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];
export const InsightTypeSchema = z.enum(INSIGHT_TYPES);

export const INSIGHT_FEEDBACK = ['useful', 'not_useful'] as const;
export type InsightFeedback = (typeof INSIGHT_FEEDBACK)[number];
export const InsightFeedbackSchema = z.enum(INSIGHT_FEEDBACK);

export const INSIGHT_SOURCES = ['rule', 'weekly'] as const;
export type InsightSource = (typeof INSIGHT_SOURCES)[number];

/** Ключи текстов инсайтов — строки живут в i18n web, общий только ключ. */
export const INSIGHT_TEXT_KEYS: Record<InsightType, string> = {
  category_spend_up: 'insights.text.categorySpendUp',
  low_energy_streak: 'insights.text.lowEnergyStreak',
  mood_with_sport: 'insights.text.moodWithSport',
  budget_exceeded: 'insights.text.budgetExceeded',
  budget_suggestion: 'insights.text.budgetSuggestion',
  wellbeing_concern: 'insights.text.wellbeingConcern',
};

/** Параметры для i18n: подставляются в шаблон по ключу. */
export type InsightParams = Record<string, string | number>;

/** Действие предложения: «Применить» создаёт бюджет через финансы. */
export interface InsightAction {
  kind: 'budget';
  categoryId: string;
  categoryName: string;
  /** Месяц бюджета «YYYY-MM». */
  month: string;
  /** Недельный ориентир, как в тексте предложения. */
  weeklyLimit: number;
  /** Месячный лимит, который создаётся в финансах (недельный × 30/7). */
  monthlyLimit: number;
}

/** Кандидат в ленту инсайтов до сохранения в БД. */
export interface InsightCandidate {
  type: InsightType;
  textKey: string;
  params: InsightParams;
  /** Вес для отбора: больше — важнее. */
  weight: number;
  action?: InsightAction | null;
}

/* ----- Правило: траты на категорию выросли (ТЗ §3.5) ----- */

export interface CategoryRiseOptions {
  /** Минимальный рост, % (по умолчанию 20). */
  minGrowthPercent?: number;
  /** Минимальная текущая сумма, чтобы не шуметь о мелочах (по умолчанию 300). */
  minCurrentTotal?: number;
  max?: number;
}

/** Траты по категориям, заметно выросшие против прошлого периода. */
export function categorySpendRiseCandidates(
  current: readonly CategorySpend[],
  previous: readonly CategorySpend[],
  options: CategoryRiseOptions = {},
): InsightCandidate[] {
  const minGrowth = options.minGrowthPercent ?? 20;
  const minTotal = options.minCurrentTotal ?? 300;
  const max = options.max ?? 3;

  const previousByCategory = new Map<string, number>();
  for (const entry of previous) {
    if (entry.categoryId) previousByCategory.set(entry.categoryId, entry.total);
  }

  return current
    .filter((entry) => entry.categoryId !== null && entry.total >= minTotal)
    .map((entry) => {
      const before = previousByCategory.get(entry.categoryId as string) ?? 0;
      const change = percentChange(entry.total, before);
      return { entry, change, before };
    })
    .filter((row): row is { entry: CategorySpend; change: number; before: number } => row.change !== null && row.change >= minGrowth)
    .sort((left, right) => right.change - left.change)
    .slice(0, max)
    .map(({ entry, change }) => ({
      type: 'category_spend_up' as const,
      textKey: INSIGHT_TEXT_KEYS.category_spend_up,
      params: { category: entry.categoryName ?? '', percent: change },
      weight: change,
    }));
}

/* ----- Правило: три дня подряд энергия ниже 2 (ТЗ §3.5) ----- */

export interface DayEnergy {
  day: string;
  energy: number | null;
}

export interface LowEnergyOptions {
  minDays?: number;
  /** Энергия считается низкой, если строго меньше порога (по умолчанию 2). */
  threshold?: number;
}

/** Текущая серия дней с низкой энергией (с конца диапазона). */
export function lowEnergyStreakCandidates(
  days: readonly DayEnergy[],
  options: LowEnergyOptions = {},
): InsightCandidate[] {
  const minDays = options.minDays ?? 3;
  const threshold = options.threshold ?? 2;

  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const energy = days[index]?.energy ?? null;
    if (energy !== null && energy < threshold) streak += 1;
    else break;
  }

  if (streak < minDays) return [];
  return [
    {
      type: 'low_energy_streak',
      textKey: INSIGHT_TEXT_KEYS.low_energy_streak,
      params: { days: streak },
      weight: streak,
    },
  ];
}

/* ----- Правило: настроение выше в дни со спортом (ТЗ §3.5) ----- */

export interface DayMood {
  day: string;
  mood: number | null;
  tags: readonly string[];
}

export interface MoodSportOptions {
  /** Тег, отмечающий физическую активность (по умолчанию «спорт»). */
  tag?: string;
  minDaysWithTag?: number;
  minDaysWithoutTag?: number;
  /** Минимальная разница среднего, чтобы показать связь (по умолчанию 0.5). */
  minDelta?: number;
}

function average(values: readonly number[]): number {
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

/** Связь тега «спорт» со средним настроением — без обещаний и диагнозов. */
export function moodWithSportCandidate(
  days: readonly DayMood[],
  options: MoodSportOptions = {},
): InsightCandidate | null {
  const tag = options.tag ?? 'спорт';
  const minWith = options.minDaysWithTag ?? 3;
  const minWithout = options.minDaysWithoutTag ?? 2;
  const minDelta = options.minDelta ?? 0.5;

  const withTag: number[] = [];
  const withoutTag: number[] = [];
  for (const day of days) {
    if (day.mood === null) continue;
    if (day.tags.includes(tag)) withTag.push(day.mood);
    else withoutTag.push(day.mood);
  }

  if (withTag.length < minWith || withoutTag.length < minWithout) return null;

  const withSport = average(withTag);
  const withoutSport = average(withoutTag);
  const delta = Math.round((withSport - withoutSport) * 10) / 10;
  if (delta < minDelta) return null;

  return {
    type: 'mood_with_sport',
    textKey: INSIGHT_TEXT_KEYS.mood_with_sport,
    params: { withSport, withoutSport, delta },
    weight: delta,
  };
}

/* ----- Правило: превышение бюджета (ТЗ §3.5) ----- */

export interface BudgetEntry {
  categoryId: string;
  categoryName: string;
  limit: number;
  spent: number;
}

export interface BudgetExceededOptions {
  max?: number;
}

/** Категории, где траты вышли за лимит бюджета месяца. */
export function budgetExceededCandidates(
  budgets: readonly BudgetEntry[],
  options: BudgetExceededOptions = {},
): InsightCandidate[] {
  const max = options.max ?? 3;

  return budgets
    .filter((budget) => budget.limit > 0 && budget.spent > budget.limit)
    .map((budget) => ({
      type: 'budget_exceeded' as const,
      textKey: INSIGHT_TEXT_KEYS.budget_exceeded,
      params: {
        category: budget.categoryName,
        percent: Math.round((budget.spent / budget.limit) * 100),
      },
      weight: Math.round((budget.spent / budget.limit) * 100),
    }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, max);
}

/* ----- Предложение недели: бюджет по категории (ТЗ §3.5) ----- */

export interface BudgetSuggestionOptions {
  /** Месяц «YYYY-MM», к которому применяется предложение. */
  month: string;
  /** Есть ли уже бюджет по этой категории — тогда предложение не нужно. */
  hasBudget?: boolean;
}

/** Предложение поставить недельный бюджет на самую крупную категорию. */
export function budgetSuggestionCandidate(
  topCategory: { categoryId: string; categoryName: string; total: number },
  options: BudgetSuggestionOptions,
): InsightCandidate | null {
  if (options.hasBudget) return null;
  const weeklyLimit = roundMoney(topCategory.total);
  if (!topCategory.categoryId || weeklyLimit <= 0) return null;

  const monthlyLimit = roundMoney((weeklyLimit * 30) / 7);
  return {
    type: 'budget_suggestion',
    textKey: INSIGHT_TEXT_KEYS.budget_suggestion,
    params: { category: topCategory.categoryName, amount: weeklyLimit },
    weight: 0,
    action: {
      kind: 'budget',
      categoryId: topCategory.categoryId,
      categoryName: topCategory.categoryName,
      month: options.month,
      weeklyLimit,
      monthlyLimit,
    },
  };
}

/* ----- Защитное правило: настроение 1 дольше 5 дней (ТЗ §3.5) ----- */

export interface WellbeingOptions {
  /** Сколько дней подряд с настроением 1 уже тревожный сигнал (по умолчанию 6 — «более 5»). */
  minDays?: number;
  /** Значение настроения, считающееся низким (по умолчанию 1). */
  moodValue?: number;
}

export interface DayMoodSample {
  day: string;
  mood: number | null;
}

/** Мягкий сигнал заботы: длинная серия очень низкого настроения. */
export function wellbeingConcernCandidates(
  days: readonly DayMoodSample[],
  options: WellbeingOptions = {},
): InsightCandidate[] {
  const minDays = options.minDays ?? 6;
  const moodValue = options.moodValue ?? 1;

  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index]?.mood === moodValue) streak += 1;
    else break;
  }

  if (streak < minDays) return [];
  return [
    {
      type: 'wellbeing_concern',
      textKey: INSIGHT_TEXT_KEYS.wellbeing_concern,
      params: { days: streak },
      weight: 1000,
    },
  ];
}

/* ----- Оценка «полезно / не полезно» (ТЗ §3.5) ----- */

export interface TypeFeedbackStat {
  type: InsightType;
  useful: number;
  notUseful: number;
}

/** Множитель веса типа: одобрения повышают, жалобы понижают (не ниже 0.1). */
export function insightTypePenalty(useful: number, notUseful: number): number {
  const score = 1 + useful * 0.1 - notUseful * 0.4;
  return Math.max(0.1, Math.round(score * 100) / 100);
}

/** Типы, которые пора реже показывать: два и более «не полезно» без одобрений. */
export function hiddenInsightTypes(
  stats: readonly TypeFeedbackStat[],
  options: { minNotUseful?: number } = {},
): InsightType[] {
  const minNotUseful = options.minNotUseful ?? 2;
  return stats
    .filter((stat) => stat.notUseful >= minNotUseful && stat.notUseful > stat.useful)
    .map((stat) => stat.type);
}

/** Строка счётчика оценок, как её отдаёт groupBy (type, feedback, count). */
export interface FeedbackCountRow {
  type: string;
  feedback: string;
  count: number;
}

/** Сворачивает строки groupBy в счётчики оценок по типу инсайта. */
export function feedbackStatsFromRows(rows: readonly FeedbackCountRow[]): TypeFeedbackStat[] {
  const stats = new Map<InsightType, TypeFeedbackStat>();

  for (const row of rows) {
    if (!(INSIGHT_TYPES as readonly string[]).includes(row.type)) continue;
    const type = row.type as InsightType;
    const stat = stats.get(type) ?? { type, useful: 0, notUseful: 0 };
    if (row.feedback === 'useful') stat.useful += row.count;
    else if (row.feedback === 'not_useful') stat.notUseful += row.count;
    stats.set(type, stat);
  }

  return [...stats.values()];
}

/** Сортировка кандидатов по весу с учётом оценок пользователя. */
export function rankInsights(
  candidates: readonly InsightCandidate[],
  stats: readonly TypeFeedbackStat[],
  options: { minNotUseful?: number } = {},
): InsightCandidate[] {
  const hidden = new Set(hiddenInsightTypes(stats, options));
  const byType = new Map(stats.map((stat) => [stat.type, stat]));

  return candidates
    .filter((candidate) => !hidden.has(candidate.type))
    .map((candidate) => {
      const stat = byType.get(candidate.type);
      const penalty = stat ? insightTypePenalty(stat.useful, stat.notUseful) : 1;
      return { candidate, score: candidate.weight * penalty };
    })
    .sort((left, right) => right.score - left.score)
    .map((row) => row.candidate);
}

export interface WeeklySelectionOptions {
  insightCount?: number;
  minNotUseful?: number;
}

export interface WeeklySelection {
  insights: InsightCandidate[];
  suggestion: InsightCandidate | null;
}

/** Недельный разбор: N инсайтов + 1 предложение на следующую неделю. */
export function selectWeeklyInsights(
  candidates: readonly InsightCandidate[],
  stats: readonly TypeFeedbackStat[],
  options: WeeklySelectionOptions = {},
): WeeklySelection {
  const insightCount = options.insightCount ?? 3;
  const hidden = new Set(hiddenInsightTypes(stats, options));

  const visible = candidates.filter((candidate) => !hidden.has(candidate.type));
  const insights = rankInsights(
    visible.filter((candidate) => candidate.type !== 'budget_suggestion'),
    stats,
    options,
  ).slice(0, insightCount);
  const suggestion =
    visible
      .filter((candidate) => candidate.type === 'budget_suggestion')
      .sort((left, right) => right.weight - left.weight)[0] ?? null;

  return { insights, suggestion };
}

/* ----- Недельное расписание: воскресенье 19:00 (ТЗ §3.5) ----- */

/** Час недельного разбора по локальному времени пользователя. */
export const WEEKLY_REPORT_HOUR = 19;

/** Номер ISO-недели «YYYY-Www» для ключа дня. */
export function isoWeekKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);

  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Смещение зоны (мс) для момента: локальное представление минус UTC. */
function zoneOffsetMs(instant: Date, timezone: string): number {
  const parts = localParts(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

/** Локальное «настенное» время зоны → момент UTC (два прохода, устойчиво к DST). */
function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  const instant = guess - zoneOffsetMs(new Date(guess), timezone);
  const offset = zoneOffsetMs(new Date(instant), timezone);
  return new Date(guess - offset);
}

/** Ближайшее прошедшее воскресенье 19:00 по времени пользователя. */
export function weeklyReportSlot(now: Date, timezone: string): Date {
  const parts = localParts(now, timezone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const beforeSlot = parts.hour < WEEKLY_REPORT_HOUR;
  const daysBack = beforeSlot ? (weekday === 0 ? 7 : weekday) : weekday;
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - daysBack));
  return wallTimeToInstant(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    target.getUTCDate(),
    WEEKLY_REPORT_HOUR,
    timezone,
  );
}

/** Наступил ли слот недельного разбора в окне (from, now]. Идемпотентно. */
export function isWeeklyReportDue(now: Date, timezone: string, from?: Date): boolean {
  const slot = weeklyReportSlot(now, timezone).getTime();
  const fromMs = (from ?? new Date(now.getTime() - 60_000)).getTime();
  return slot > fromMs && slot <= now.getTime();
}

/* ----- Справочник служб поддержки (ТЗ §3.5) ----- */

export const SUPPORT_COUNTRIES = ['RU', 'UA', 'KZ', 'BY', 'US', 'GB', 'DE', 'INT'] as const;
export type SupportCountry = (typeof SUPPORT_COUNTRIES)[number];
export const SupportCountrySchema = z.enum(SUPPORT_COUNTRIES);

export interface SupportResource {
  country: SupportCountry;
  /** i18n-ключ названия службы. */
  nameKey: string;
  /** i18n-ключ короткого описания — без диагнозов и обещаний лечения. */
  descriptionKey: string;
  phone: string | null;
  url: string | null;
}

/**
 * Контакты служб поддержки по странам и общий международный справочник.
 * Телефоны — круглосуточные линии психологической поддержки (проверены по
 * открытым источникам); тексты — только ключи i18n.
 */
export const SUPPORT_RESOURCES: readonly SupportResource[] = [
  {
    country: 'RU',
    nameKey: 'support.RU.name',
    descriptionKey: 'support.RU.description',
    phone: '8-800-100-49-94',
    url: 'https://psi.mchs.gov.ru',
  },
  {
    country: 'UA',
    nameKey: 'support.UA.name',
    descriptionKey: 'support.UA.description',
    phone: '7333',
    url: 'https://lifelineukraine.com',
  },
  {
    country: 'KZ',
    nameKey: 'support.KZ.name',
    descriptionKey: 'support.KZ.description',
    phone: '111',
    url: 'https://gov4c.kz/ru/about/kontakt-tsentr-111/',
  },
  {
    country: 'BY',
    nameKey: 'support.BY.name',
    descriptionKey: 'support.BY.description',
    phone: '133',
    url: 'https://mocpin.by/psikhologicheskaya-pomoshch/telefon-doveriya/',
  },
  {
    country: 'US',
    nameKey: 'support.US.name',
    descriptionKey: 'support.US.description',
    phone: '988',
    url: 'https://988lifeline.org',
  },
  {
    country: 'GB',
    nameKey: 'support.GB.name',
    descriptionKey: 'support.GB.description',
    phone: '116 123',
    url: 'https://www.samaritans.org',
  },
  {
    country: 'DE',
    nameKey: 'support.DE.name',
    descriptionKey: 'support.DE.description',
    phone: '0800 111 0 111',
    url: 'https://www.telefonseelsorge.de',
  },
  {
    country: 'INT',
    nameKey: 'support.INT.name',
    descriptionKey: 'support.INT.description',
    phone: null,
    url: 'https://findahelpline.com',
  },
];

const RU_CITIES = new Set([
  'Moscow', 'Kaliningrad', 'Samara', 'Volgograd', 'Saratov', 'Kirov', 'Ulyanovsk',
  'Astrakhan', 'Ufa', 'Perm', 'Chelyabinsk', 'Orenburg', 'Rostov', 'Voronezh',
  'Yekaterinburg', 'Omsk', 'Novosibirsk', 'Krasnoyarsk', 'Irkutsk', 'Yakutsk',
  'Vladivostok', 'Magadan', 'Khabarovsk', 'Sakhalin', 'Barnaul', 'Tomsk', 'Chita',
]);
const UA_CITIES = new Set(['Kyiv', 'Kiev', 'Uzhgorod', 'Zaporozhye', 'Simferopol']);
const KZ_CITIES = new Set(['Almaty', 'Aqtobe', 'Atyrau', 'Qostanay', 'Qyzylorda', 'Oral', 'Aktau']);
const GB_CITIES = new Set(['London', 'Belfast', 'Jersey', 'Guernsey', 'Isle_of_Man']);
const DE_CITIES = new Set(['Berlin', 'Busingen']);

/** Страна пользователя по часовому поясу; незнакомая зона — общий справочник. */
export function countryFromTimezone(timezone: string): SupportCountry {
  const trimmed = timezone.trim();
  const city = trimmed.includes('/') ? trimmed.slice(trimmed.indexOf('/') + 1) : trimmed;

  if (RU_CITIES.has(city)) return 'RU';
  if (UA_CITIES.has(city)) return 'UA';
  if (KZ_CITIES.has(city)) return 'KZ';
  if (city === 'Minsk') return 'BY';
  if (GB_CITIES.has(city)) return 'GB';
  if (DE_CITIES.has(city)) return 'DE';
  if (trimmed.startsWith('America/')) return 'US';
  return 'INT';
}

/** Контакты поддержки: служба страны пользователя и международная линия. */
export function supportResourcesFor(timezone: string): SupportResource[] {
  const country = countryFromTimezone(timezone);
  const own = SUPPORT_RESOURCES.filter((resource) => resource.country === country);
  const international =
    country === 'INT' ? [] : SUPPORT_RESOURCES.filter((resource) => resource.country === 'INT');
  return [...own, ...international];
}

/* ----- Контракты API (общие для web и api) ----- */

export const InsightFeedbackInputSchema = z.object({
  feedback: InsightFeedbackSchema,
});
export type InsightFeedbackInput = z.infer<typeof InsightFeedbackInputSchema>;

export const InsightsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type InsightsListQuery = z.infer<typeof InsightsListQuerySchema>;

export interface InsightActionDto extends InsightAction {
  applied: boolean;
}

export interface InsightDto {
  id: string;
  type: InsightType;
  textKey: string;
  params: InsightParams;
  source: InsightSource;
  action: InsightAction | null;
  appliedAt: string | null;
  feedback: InsightFeedback | null;
  createdAt: string;
}

export type SupportResourceDto = SupportResource;

export interface InsightsFeedResponse {
  insights: InsightDto[];
  /** Справочник поддержки — заполняется, когда есть сигнал о самочувствии. */
  support: SupportResourceDto[];
  country: SupportCountry;
}

export interface InsightsFeedbackResponse {
  insight: InsightDto;
}

export interface InsightsApplyResponse {
  insight: InsightDto;
  budgetId: string;
}

export interface WeeklyReportResponse {
  weekKey: string;
  insights: InsightDto[];
  suggestion: InsightDto | null;
}
