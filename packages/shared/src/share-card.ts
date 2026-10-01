// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Карточка «Поделиться результатом» (ТЗ §3.7, §4 P1, §5 сценарий 2):
 * чистая генерация SVG без нативных зависимостей и побочных эффектов.
 * API отдаёт готовый SVG и растеризует его в PNG, web показывает предпросмотр
 * и делится файлом через Web Share API. Форматы: story 1080×1920 и square
 * 1080×1080. Суммы по умолчанию скрыты — показываются проценты (ТЗ §3.7).
 */
import { z } from 'zod';
import { LocaleSchema, type Locale } from './auth';
import { ACHIEVEMENT_CODES, type AchievementCode } from './achievements';
import { formatMoney, type Currency } from './money';

/* ----- Типы и форматы ----- */

export const SHARE_CARD_TYPES = [
  'goal_progress',
  'checkin_streak',
  'achievement',
  'avg_mood',
] as const;
export type ShareCardType = (typeof SHARE_CARD_TYPES)[number];

export const SHARE_CARD_FORMATS = ['story', 'square'] as const;
export type ShareCardFormat = (typeof SHARE_CARD_FORMATS)[number];

/** Размеры форматов: сторис вертикальный, квадрат — для ленты (ТЗ §3.7). */
export const SHARE_CARD_SIZES: Record<ShareCardFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export const SHARE_CARD_THEMES = ['light', 'dark'] as const;
export type ShareCardTheme = (typeof SHARE_CARD_THEMES)[number];

/* ----- Данные карточки ----- */

export interface ShareGoalCardData {
  type: 'goal_progress';
  title: string;
  /** Прогресс 0..100. */
  percent: number;
  savedAmount: number | null;
  targetAmount: number | null;
  currency: string;
}

export interface ShareStreakCardData {
  type: 'checkin_streak';
  current: number;
  longest: number;
  checkedToday: boolean;
}

export interface ShareAchievementCardData {
  type: 'achievement';
  code: string;
  earnedAt: string | null;
}

export interface ShareMoodCardData {
  type: 'avg_mood';
  /** Среднее настроение за месяц (1..5) или null, если чек-инов не было. */
  average: number | null;
  checkins: number;
  /** Месяц «YYYY-MM» — для подписи. */
  month: string | null;
}

/** Данные одной из четырёх карточек (дискриминатор `type`). */
export type ShareCardData =
  ShareGoalCardData | ShareStreakCardData | ShareAchievementCardData | ShareMoodCardData;

export interface ShareCardOptions {
  locale?: Locale;
  format?: ShareCardFormat;
  /** Показывать суммы на карточке цели (по умолчанию скрыты — ТЗ §3.7). */
  showAmounts?: boolean;
  theme?: ShareCardTheme;
  appName?: string;
  siteUrl?: string | null;
}

/* ----- Запрос карточки (общий для API и web) ----- */

export const ShareCardQuerySchema = z.object({
  type: z.enum(SHARE_CARD_TYPES),
  /** id цели или код достижения; для стрика и настроения не нужен. */
  id: z.string().trim().min(1).max(120).optional(),
  format: z.enum(SHARE_CARD_FORMATS).default('story'),
  locale: LocaleSchema.default('ru'),
  /** 1 — показать суммы; 0 (по умолчанию) — только проценты. */
  amounts: z.coerce.number().int().min(0).max(1).default(0),
});
export type ShareCardQuery = z.infer<typeof ShareCardQuerySchema>;

/* ----- Экранирование XML ----- */

/**
 * Экранирует текст для вставки в SVG (ТЗ §3.7): пользовательские названия
 * целей не должны ломать разметку или вставлять разметку.
 */
export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ----- Подписи ru/en (ТЗ §6: локализация на карточке) ----- */

interface ShareCardLabels {
  goalTitle: string;
  streakTitle: string;
  achievementTitle: string;
  moodTitle: string;
  saved: string;
  target: string;
  /** «дней подряд» / «days in a row». */
  daysInRow: (days: number) => string;
  outOfFive: string;
  checkins: (count: number) => string;
  noData: string;
  earnedOn: string;
  shareAppName: string;
  tagline: string;
}

const LABELS: Record<Locale, ShareCardLabels> = {
  ru: {
    goalTitle: 'Прогресс цели',
    streakTitle: 'Серия чек-инов',
    achievementTitle: 'Достижение',
    moodTitle: 'Среднее настроение',
    saved: 'Накоплено',
    target: 'Цель',
    daysInRow: (days) => `${days} дней подряд`,
    outOfFive: 'из 5',
    checkins: (count) => `${count} чек-инов`,
    noData: 'Пока нет данных',
    earnedOn: 'Получено',
    shareAppName: 'Пульс',
    tagline: 'Финансы и самочувствие в одном месте',
  },
  en: {
    goalTitle: 'Goal progress',
    streakTitle: 'Check-in streak',
    achievementTitle: 'Achievement',
    moodTitle: 'Average mood',
    saved: 'Saved',
    target: 'Goal',
    daysInRow: (days) => `${days} days in a row`,
    outOfFive: 'out of 5',
    checkins: (count) => `${count} check-ins`,
    noData: 'No data yet',
    earnedOn: 'Earned',
    shareAppName: 'Pulse',
    tagline: 'Finances and wellbeing in one place',
  },
};

/** Названия бейджей для карточки (ТЗ §4): без зависимости от i18n веба. */
const ACHIEVEMENT_TITLES: Record<AchievementCode, Record<Locale, string>> = {
  first_checkin: { ru: 'Первый шаг', en: 'First step' },
  checkin_streak_7: { ru: 'Неделя в ритме', en: 'A week in rhythm' },
  checkin_streak_30: { ru: 'Месяц привычки', en: 'A month of habit' },
  checkin_streak_100: { ru: 'Сто дней', en: 'One hundred days' },
  first_transaction: { ru: 'Первая запись', en: 'First entry' },
  first_budget_closed: { ru: 'В рамках бюджета', en: 'Within budget' },
  first_goal: { ru: 'Первый ориентир', en: 'First milestone' },
  goal_half: { ru: 'Половина пути', en: 'Halfway there' },
  goal_complete: { ru: 'Цель достигнута', en: 'Goal reached' },
};

/** Название бейджа для карточки по коду и локали (fallback — сам код). */
export function shareAchievementTitle(code: string, locale: Locale = 'ru'): string {
  const entry = ACHIEVEMENT_TITLES[code as AchievementCode];
  return entry ? entry[locale] : code;
}

function isAchievementCode(value: string): value is AchievementCode {
  return (ACHIEVEMENT_CODES as readonly string[]).includes(value);
}

export { isAchievementCode as isShareAchievementCode };

/* ----- Цвета (ТЗ §8) ----- */

interface ShareThemePalette {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  primary: string;
  finance: string;
  wellbeing: string;
}

const THEMES: Record<ShareCardTheme, ShareThemePalette> = {
  light: {
    bg: '#FAF8F5',
    surface: '#FFFFFF',
    ink: '#1C1C24',
    muted: '#6E6E7A',
    primary: '#5B5BD6',
    finance: '#2BA889',
    wellbeing: '#F2A25C',
  },
  dark: {
    bg: '#14141A',
    surface: '#1E1E26',
    ink: '#EDEDF2',
    muted: '#9A9AA8',
    primary: '#8B8BF5',
    finance: '#3DD6AE',
    wellbeing: '#F7B87E',
  },
};

function accentFor(type: ShareCardType, palette: ShareThemePalette): string {
  if (type === 'goal_progress') return palette.finance;
  if (type === 'achievement') return palette.primary;
  return palette.wellbeing;
}

/* ----- Вспомогательные функции рендера ----- */

const FONT_STACK = 'Manrope, Inter, "DejaVu Sans", "Liberation Sans", Arial, sans-serif';

interface TextOptions {
  size: number;
  weight?: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
  letterSpacing?: number;
  opacity?: number;
}

function text(x: number, y: number, content: string, options: TextOptions): string {
  const anchor = options.anchor ?? 'middle';
  const weight = options.weight ?? 600;
  const spacing =
    options.letterSpacing !== undefined ? ` letter-spacing="${options.letterSpacing}"` : '';
  const opacity = options.opacity !== undefined ? ` opacity="${options.opacity}"` : '';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family='${FONT_STACK}' font-size="${options.size}" font-weight="${weight}" fill="${options.fill}"${spacing}${opacity}>${escapeXml(content)}</text>`;
}

function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return '0%';
  return `${Math.min(100, Math.max(0, Math.round(percent)))}%`;
}

function formatAmount(amount: number, currency: string, locale: Locale): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'ru-RU';
  if (!Number.isFinite(amount)) return '';
  try {
    return formatMoney(amount, currency as Currency, intlLocale);
  } catch {
    return `${Math.round(amount)}`;
  }
}

/** Среднее настроение: одна цифра после запятой, разделитель по локали. */
function formatMood(average: number, locale: Locale): string {
  const rounded = Math.round(average * 10) / 10;
  const value = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return locale === 'ru' ? value.replace('.', ',') : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ----- Сборка карточки ----- */

interface Section {
  /** Строки <text> и <rect>, собранные сверху вниз. */
  markup: string[];
}

/**
 * Чистая функция: данные + опции → строка SVG (ТЗ §3.7).
 * Никаких обращений к времени, сети или файлам — результат предсказуем.
 */
export function renderShareCard(data: ShareCardData, options: ShareCardOptions = {}): string {
  const locale = options.locale ?? 'ru';
  const format = options.format ?? 'story';
  const theme = options.theme ?? 'light';
  const labels = LABELS[locale];
  const palette = THEMES[theme];
  const { width, height } = SHARE_CARD_SIZES[format];
  const accent = accentFor(data.type, palette);
  const appName = options.appName ?? labels.shareAppName;
  const centerX = width / 2;

  const section = buildSection(data, {
    locale,
    labels,
    palette,
    accent,
    centerX,
    format,
    showAmounts: options.showAmounts ?? false,
  });

  const footerY = height - 96;
  const siteUrl = options.siteUrl ? String(options.siteUrl) : '';

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(cardAriaLabel(data, labels))}">`,
  );
  // Фон и мягкий декоративный акцент (ТЗ §8: спокойный компаньон).
  parts.push(`<rect width="${width}" height="${height}" fill="${palette.bg}"/>`);
  parts.push(
    `<circle cx="${centerX}" cy="${Math.round(height * 0.24)}" r="${format === 'story' ? 180 : 140}" fill="${accent}" opacity="0.12"/>`,
  );
  parts.push(
    `<text x="${centerX}" y="${format === 'story' ? 168 : 132}" text-anchor="middle" font-family='${FONT_STACK}' font-size="46" font-weight="700" fill="${palette.primary}">${escapeXml(appName)}</text>`,
  );

  parts.push(...section.markup);

  // Подвал: подпись продукта и (опционально) адрес.
  parts.push(
    `<text x="${centerX}" y="${footerY}" text-anchor="middle" font-family='${FONT_STACK}' font-size="36" font-weight="500" fill="${palette.muted}">${escapeXml(labels.tagline)}</text>`,
  );
  if (siteUrl.length > 0) {
    parts.push(
      `<text x="${centerX}" y="${footerY + 56}" text-anchor="middle" font-family='${FONT_STACK}' font-size="34" font-weight="600" fill="${palette.primary}">${escapeXml(siteUrl)}</text>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

function cardAriaLabel(data: ShareCardData, labels: ShareCardLabels): string {
  switch (data.type) {
    case 'goal_progress':
      return `${labels.goalTitle}: ${formatPercent(data.percent)} — ${data.title}`;
    case 'checkin_streak':
      return `${labels.streakTitle}: ${labels.daysInRow(data.current)}`;
    case 'achievement':
      return `${labels.achievementTitle}: ${shareAchievementTitle(data.code)}`;
    case 'avg_mood':
      return `${labels.moodTitle}: ${data.average === null ? labels.noData : `${data.average} ${labels.outOfFive}`}`;
  }
}

interface SectionContext {
  locale: Locale;
  labels: ShareCardLabels;
  palette: ShareThemePalette;
  accent: string;
  centerX: number;
  format: ShareCardFormat;
  showAmounts: boolean;
}

function buildSection(data: ShareCardData, context: SectionContext): Section {
  switch (data.type) {
    case 'goal_progress':
      return buildGoalSection(data, context);
    case 'checkin_streak':
      return buildStreakSection(data, context);
    case 'achievement':
      return buildAchievementSection(data, context);
    case 'avg_mood':
      return buildMoodSection(data, context);
  }
}

function buildGoalSection(data: ShareGoalCardData, context: SectionContext): Section {
  const { centerX, palette, labels, locale, accent, format } = context;
  const bigSize = format === 'story' ? 260 : 200;
  const center = (SHARE_CARD_SIZES[format].height * (format === 'story' ? 0.42 : 0.38)) | 0;
  const markup: string[] = [];

  markup.push(
    text(centerX, center - 200, labels.goalTitle.toUpperCase(), {
      size: 40,
      weight: 700,
      fill: palette.muted,
      letterSpacing: 4,
    }),
  );
  markup.push(
    text(centerX, center + 60, formatPercent(data.percent), {
      size: bigSize,
      weight: 800,
      fill: accent,
    }),
  );
  markup.push(
    text(centerX, center + 170, data.title, {
      size: format === 'story' ? 60 : 48,
      weight: 700,
      fill: palette.ink,
    }),
  );

  // Прогресс-бар (ТЗ §8: прогресс полосами).
  const barWidth = format === 'story' ? 760 : 640;
  const barHeight = 28;
  const barX = centerX - barWidth / 2;
  const barY = center + 240;
  const fraction = clamp(data.percent / 100, 0, 1);
  const radius = barHeight / 2;
  markup.push(
    `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${radius}" fill="${palette.surface}"/>`,
  );
  markup.push(
    `<rect x="${barX}" y="${barY}" width="${Math.round(barWidth * fraction)}" height="${barHeight}" rx="${radius}" fill="${accent}"/>`,
  );

  if (context.showAmounts && data.savedAmount !== null && data.targetAmount !== null) {
    const saved = formatAmount(data.savedAmount, data.currency, locale);
    const target = formatAmount(data.targetAmount, data.currency, locale);
    markup.push(
      text(centerX, barY + 130, `${labels.saved}: ${saved} / ${labels.target}: ${target}`, {
        size: 42,
        weight: 600,
        fill: palette.ink,
        opacity: 0.9,
      }),
    );
  }

  return { markup };
}

function buildStreakSection(data: ShareStreakCardData, context: SectionContext): Section {
  const { centerX, palette, labels, accent, format } = context;
  const bigSize = format === 'story' ? 300 : 230;
  const center = (SHARE_CARD_SIZES[format].height * (format === 'story' ? 0.42 : 0.38)) | 0;
  const markup: string[] = [];

  markup.push(
    text(centerX, center - 200, labels.streakTitle.toUpperCase(), {
      size: 40,
      weight: 700,
      fill: palette.muted,
      letterSpacing: 4,
    }),
  );
  markup.push(
    text(centerX, center + 80, String(Math.max(0, data.current)), {
      size: bigSize,
      weight: 800,
      fill: accent,
    }),
  );
  markup.push(
    text(centerX, center + 170, labels.daysInRow(Math.max(0, data.current)), {
      size: format === 'story' ? 56 : 46,
      weight: 700,
      fill: palette.ink,
    }),
  );
  if (data.longest > data.current) {
    markup.push(
      text(centerX, center + 280, `${labels.streakTitle}: ${data.longest}`, {
        size: 40,
        weight: 500,
        fill: palette.muted,
      }),
    );
  }

  return { markup };
}

function buildAchievementSection(data: ShareAchievementCardData, context: SectionContext): Section {
  const { centerX, palette, labels, locale, accent, format } = context;
  const center = (SHARE_CARD_SIZES[format].height * (format === 'story' ? 0.42 : 0.38)) | 0;
  const markup: string[] = [];
  const title = shareAchievementTitle(data.code, locale);

  markup.push(
    text(centerX, center - 200, labels.achievementTitle.toUpperCase(), {
      size: 40,
      weight: 700,
      fill: palette.muted,
      letterSpacing: 4,
    }),
  );
  markup.push(
    `<text x="${centerX}" y="${center - 20}" text-anchor="middle" font-size="${format === 'story' ? 220 : 170}">${escapeXml(achievementEmoji(data.code))}</text>`,
  );
  markup.push(
    text(centerX, center + 150, title, {
      size: format === 'story' ? 68 : 54,
      weight: 800,
      fill: palette.ink,
    }),
  );

  if (data.earnedAt) {
    const day = data.earnedAt.slice(0, 10);
    markup.push(
      text(centerX, center + 240, `${labels.earnedOn}: ${day}`, {
        size: 40,
        weight: 500,
        fill: accent,
      }),
    );
  }

  return { markup };
}

function buildMoodSection(data: ShareMoodCardData, context: SectionContext): Section {
  const { centerX, palette, labels, locale, accent, format } = context;
  const bigSize = format === 'story' ? 300 : 230;
  const center = (SHARE_CARD_SIZES[format].height * (format === 'story' ? 0.42 : 0.38)) | 0;
  const markup: string[] = [];

  markup.push(
    text(centerX, center - 200, labels.moodTitle.toUpperCase(), {
      size: 40,
      weight: 700,
      fill: palette.muted,
      letterSpacing: 4,
    }),
  );
  markup.push(
    text(centerX, center + 80, data.average === null ? '—' : formatMood(data.average, locale), {
      size: bigSize,
      weight: 800,
      fill: accent,
    }),
  );
  markup.push(
    text(centerX, center + 170, data.average === null ? labels.noData : labels.outOfFive, {
      size: format === 'story' ? 56 : 46,
      weight: 600,
      fill: palette.ink,
    }),
  );
  markup.push(
    text(centerX, center + 270, labels.checkins(Math.max(0, data.checkins)), {
      size: 40,
      weight: 500,
      fill: palette.muted,
    }),
  );

  return { markup };
}

/** Эмодзи бейджа (ТЗ §8: иконки Lucide, эмодзи только там, где уместно). */
export function achievementEmoji(code: string): string {
  const map: Record<string, string> = {
    first_checkin: '🌱',
    checkin_streak_7: '🔥',
    checkin_streak_30: '🏅',
    checkin_streak_100: '💯',
    first_transaction: '🧾',
    first_budget_closed: '📊',
    first_goal: '🎯',
    goal_half: '⛰️',
    goal_complete: '🏆',
  };
  return map[code] ?? '⭐';
}
