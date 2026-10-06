// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистая логика уведомлений (ТЗ §3.6, §5 сценарий 1, §7, §9): расписание
 * отправки с учётом часового пояса пользователя, тихих часов (в т.ч. через
 * полночь), переходов DST и отдельного включения каждого типа.
 *
 * Здесь нет побочных эффектов и обращений к БД — только расчёты, пригодные
 * для unit-тестов и переиспользования в API и web.
 */
import { z } from 'zod';

/* ----- Типы и каналы ----- */

export const NOTIFICATION_TYPES = [
  'checkins',
  'daily_summary',
  'payments',
  'budget',
  'reconciliation_mismatch',
  'weekly_report',
  'reactions',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** Каналы доставки: только мессенджеры (web push и email убраны в v2). */
export const NOTIFICATION_CHANNELS = ['telegram', 'discord'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

/* ----- Тихие часы ----- */

/** Тихие часы в целых часах. Если start > end — период переходит через полночь. */
export interface QuietHours {
  start: number;
  end: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { start: 22, end: 8 };

export const QuietHoursSchema = z
  .object({
    start: z.number().int().min(0).max(24),
    end: z.number().int().min(0).max(24),
  })
  .default(DEFAULT_QUIET_HOURS);

/** Время суток попадает в тихие часы (граница end — уже не тихие часы). */
export function isWithinQuietHours(minuteOfDay: number, quiet: QuietHours): boolean {
  const start = quiet.start * 60;
  const end = quiet.end * 60;
  if (start === end) return false;

  if (start < end) {
    return minuteOfDay >= start && minuteOfDay < end;
  }
  // Через полночь: [start..24:00) ∪ [00:00..end)
  return minuteOfDay >= start || minuteOfDay < end;
}

/* ----- Время суток ----- */

export const MIN_TIMES_PER_DAY = 1;
export const MAX_TIMES_PER_DAY = 6;

/** Расписание по умолчанию: 3 раза в день — утро/день/вечер (ТЗ §5, сценарий 1). */
export const DEFAULT_TIMES_PER_DAY = 3;

const TIMES_BY_COUNT: Record<number, readonly string[]> = {
  1: ['09:00'],
  2: ['09:00', '21:00'],
  3: ['09:00', '15:00', '21:00'],
  4: ['09:00', '13:00', '17:00', '21:00'],
  5: ['09:00', '12:00', '15:00', '18:00', '21:00'],
  6: ['09:00', '11:00', '13:00', '15:00', '18:00', '21:00'],
};

/** Готовое расписание для 1–6 слотов в день (значения вне диапазона зажимаются). */
export function timesForCount(count: number): string[] {
  const rounded = Number.isFinite(count) ? Math.round(count) : DEFAULT_TIMES_PER_DAY;
  const clamped = Math.min(MAX_TIMES_PER_DAY, Math.max(MIN_TIMES_PER_DAY, rounded));
  return [...TIMES_BY_COUNT[clamped]];
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Разбирает «HH:MM» в часы и минуты; null — если строка некорректна. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Минуты от начала суток для «HH:MM»; null — если строка некорректна. */
export function minutesOfDay(value: string): number | null {
  const parsed = parseTimeOfDay(value);
  return parsed ? parsed.hour * 60 + parsed.minute : null;
}

/** «HH:MM» из минут от начала суток. */
export function formatTimeOfDay(time: { hour: number; minute: number } | number): string {
  const hour = typeof time === 'number' ? Math.floor(time / 60) : time.hour;
  const minute = typeof time === 'number' ? Math.round(time % 60) : time.minute;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Приводит вход (число слотов или список «HH:MM») к отсортированному списку. */
export function normalizeTimes(input?: readonly string[] | number): string[] {
  if (input === undefined) return timesForCount(DEFAULT_TIMES_PER_DAY);
  if (typeof input === 'number') return timesForCount(input);

  const valid = input
    .map((value) => parseTimeOfDay(value))
    .filter((value): value is { hour: number; minute: number } => value !== null)
    .map((value) => value.hour * 60 + value.minute);

  if (valid.length === 0) return timesForCount(DEFAULT_TIMES_PER_DAY);

  const unique = [...new Set(valid)].sort((a, b) => a - b);
  return unique.slice(0, MAX_TIMES_PER_DAY).map((value) => formatTimeOfDay(value));
}

/* ----- Часовой пояс и переходы DST ----- */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Локальные календарные компоненты момента в заданном часовом поясе. */
export function localParts(date: Date, timeZone: string): CalendarParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Смещение зоны (мс): локальное представление минус UTC. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Переводит локальное «настенное» время зоны в конкретный момент UTC.
 * Два прохода по смещению корректно обрабатывают переходы DST: смещение
 * проверяется в найденном моменте, а не в предположительном.
 */
function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = zoneOffsetMs(new Date(utcGuess), timeZone);
  const instant = utcGuess - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(instant), timeZone);
  return new Date(utcGuess - secondOffset);
}

function addDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Переносит слот, попавший в тихие часы, на их конец. */
function shiftOutOfQuietHours(slot: WallClock, quiet: QuietHours): WallClock {
  const minuteOfDay = slot.hour * 60 + slot.minute;
  if (!isWithinQuietHours(minuteOfDay, quiet)) return slot;

  // Если тихие часы переходят через полночь и слот после их начала —
  // конец наступает на следующий календарный день.
  const nextDay = quiet.start > quiet.end && minuteOfDay >= quiet.start * 60;
  const shifted = addDays(slot.year, slot.month, slot.day, nextDay ? 1 : 0);
  const endMinute = Math.round(quiet.end * 60);

  return {
    ...shifted,
    hour: Math.floor(endMinute / 60),
    minute: endMinute % 60,
  };
}

/**
 * Ближайший момент не раньше `now`, когда отправка разрешена: вне тихих часов
 * возвращает `now`, внутри — их конец (по часовому поясу пользователя).
 */
export function nextAllowedTime(now: Date, timezone: string, quiet: QuietHours): Date {
  const zone = timezone || 'UTC';
  const local = localParts(now, zone);
  const slot: WallClock = {
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
  };
  if (!isWithinQuietHours(local.hour * 60 + local.minute, quiet)) return now;

  const shifted = shiftOutOfQuietHours(slot, quiet);
  return wallTimeToInstant(
    shifted.year,
    shifted.month,
    shifted.day,
    shifted.hour,
    shifted.minute,
    zone,
  );
}

export interface NextDeliveryOptions {
  /** Текущий момент (строго раньше искомого слота). */
  now: Date;
  /** IANA-зона пользователя, например «Europe/Moscow». */
  timezone: string;
  /** Время отправки: число слотов (1–6) или список «HH:MM». */
  times?: readonly string[] | number;
  /** Тихие часы; по умолчанию 22:00–08:00 (ТЗ §3.6). */
  quietHours?: QuietHours;
  /** Привычное время утреннего ответа («HH:MM») — умное время (ТЗ §3.6). */
  morningTime?: string;
}

/**
 * Ближайшее время отправки строго после `now` с учётом часового пояса,
 * расписания и тихих часов (ТЗ §9).
 */
export function nextDeliveryTime(options: NextDeliveryOptions): Date {
  const timezone = options.timezone || 'UTC';
  const quiet = options.quietHours ?? DEFAULT_QUIET_HOURS;
  const now = options.now;
  const nowMs = now.getTime();

  const times = withMorningTime(normalizeTimes(options.times), options.morningTime);

  const today = localParts(now, timezone);

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const calendarDay = addDays(today.year, today.month, today.day, dayOffset);

    for (const time of times) {
      const parsed = parseTimeOfDay(time);
      if (!parsed) continue;

      let slot: WallClock = {
        ...calendarDay,
        hour: parsed.hour,
        minute: parsed.minute,
      };
      // Тихие часы определяются по локальному времени слота.
      slot = shiftOutOfQuietHours(slot, quiet);

      const instant = wallTimeToInstant(
        slot.year,
        slot.month,
        slot.day,
        slot.hour,
        slot.minute,
        timezone,
      );

      if (instant.getTime() > nowMs) return instant;
    }
  }

  // Недостижимо при корректном расписании, но оставляем детерминированный запас.
  const fallbackDay = addDays(today.year, today.month, today.day, 1);
  return wallTimeToInstant(fallbackDay.year, fallbackDay.month, fallbackDay.day, 9, 0, timezone);
}

/* ----- Выбор due-уведомлений для планировщика ----- */

export interface DeliveryWindow {
  /** Нижняя граница (исключительно). */
  from: Date;
  /** Верхняя граница (включительно). */
  to: Date;
  timezone: string;
}

export interface DeliveryScheduleOptions {
  times?: readonly string[] | number;
  quietHours?: QuietHours;
  morningTime?: string;
}

function isAfterDay(
  day: { year: number; month: number; day: number },
  limit: { year: number; month: number; day: number },
): boolean {
  if (day.year !== limit.year) return day.year > limit.year;
  if (day.month !== limit.month) return day.month > limit.month;
  return day.day > limit.day;
}

/**
 * Был ли плановый момент отправки в интервале (from, to]. Используется
 * планировщиком, чтобы выбрать «созревшие» уведомления (ТЗ §9).
 */
export function deliveryOccurredBetween(
  window: DeliveryWindow,
  options: DeliveryScheduleOptions = {},
): boolean {
  const fromMs = window.from.getTime();
  const toMs = window.to.getTime();
  if (!(toMs > fromMs)) return false;

  const timezone = window.timezone || 'UTC';
  const quiet = options.quietHours ?? DEFAULT_QUIET_HOURS;
  const times = withMorningTime(normalizeTimes(options.times), options.morningTime);

  const start = localParts(window.from, timezone);
  const end = localParts(window.to, timezone);
  const startDay = addDays(start.year, start.month, start.day, -1);

  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addDays(startDay.year, startDay.month, startDay.day, offset);
    if (isAfterDay(day, end)) break;

    for (const time of times) {
      const parsed = parseTimeOfDay(time);
      if (!parsed) continue;

      const slot = shiftOutOfQuietHours(
        { ...day, hour: parsed.hour, minute: parsed.minute },
        quiet,
      );
      const instant = wallTimeToInstant(
        slot.year,
        slot.month,
        slot.day,
        slot.hour,
        slot.minute,
        timezone,
      ).getTime();

      if (instant > fromMs && instant <= toMs) return true;
    }
  }

  return false;
}

/** Типы включённых правил, у которых в окне есть плановая отправка. */
export function selectDueTypes(
  rules: readonly NotificationRuleConfig[],
  window: DeliveryWindow,
): NotificationType[] {
  return rules
    .filter((rule) => rule.enabled)
    .filter((rule) =>
      deliveryOccurredBetween(window, {
        times: rule.times,
        quietHours: rule.quietHours,
      }),
    )
    .map((rule) => rule.type);
}

/* ----- Умное время (ТЗ §3.6) ----- */
/**
 * Привычное время ответа — медиана времени ответов (локально). Возвращает
 * «HH:MM» или null, если данных нет. Устойчиво к выбросам (медиана).
 */
export function typicalAnswerTime(samples: readonly (string | number)[]): string | null {
  const minutes = samples
    .map((sample) => {
      if (typeof sample === 'number') return Number.isFinite(sample) ? Math.round(sample) : null;
      return minutesOfDay(sample);
    })
    .filter((value): value is number => value !== null && value >= 0 && value < 24 * 60);

  if (minutes.length === 0) return null;
  minutes.sort((a, b) => a - b);
  const middle = Math.floor(minutes.length / 2);
  const median =
    minutes.length % 2 === 0
      ? Math.round((minutes[middle - 1] + minutes[middle]) / 2)
      : minutes[middle];

  return formatTimeOfDay(median);
}

/** Заменяет утренний (первый) слот на привычное время ответа (ТЗ §3.6). */
export function withMorningTime(times: readonly string[] | number, morningTime?: string): string[] {
  const normalized = normalizeTimes(times);
  if (!morningTime) return normalized;

  const parsed = parseTimeOfDay(morningTime);
  if (!parsed) return normalized;

  const replacement = formatTimeOfDay(parsed);
  if (normalized.length === 0) return [replacement];

  return [replacement, ...normalized.slice(1)].sort(
    (a, b) => (minutesOfDay(a) ?? 0) - (minutesOfDay(b) ?? 0),
  );
}

/* ----- Правила по типам ----- */

export interface NotificationRuleConfig {
  type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
  times: string[];
  quietHours: QuietHours;
}

/** Правило одного типа уведомлений. */
export function defaultNotificationRule(
  type: NotificationType,
  overrides: Partial<Omit<NotificationRuleConfig, 'type'>> = {},
): NotificationRuleConfig {
  return {
    type,
    channel: 'telegram',
    enabled: true,
    times: timesForCount(DEFAULT_TIMES_PER_DAY),
    quietHours: { ...DEFAULT_QUIET_HOURS },
    ...overrides,
  };
}

/** Правила по умолчанию для всех типов (ТЗ §3.6, §7). */
export function defaultNotificationRules(): NotificationRuleConfig[] {
  return NOTIFICATION_TYPES.map((type) => defaultNotificationRule(type));
}

/** Включён ли конкретный тип (отдельное включение каждого типа, ТЗ §3.6). */
export function isTypeEnabled(
  rules: readonly Pick<NotificationRuleConfig, 'type' | 'enabled'>[],
  type: NotificationType,
): boolean {
  return rules.some((rule) => rule.type === type && rule.enabled);
}

/* ----- Настройки каналов ----- */

/** Время «итога дня» по умолчанию (локальное, «HH:MM»). */
export const DEFAULT_SUMMARY_TIME = '21:30';

const HHMM = /^\d{1,2}:\d{2}$/;

/** Настройки одного канала: включён ли, расписание, тихие часы, часовой пояс и типы. */
export interface ChannelSettingsConfig {
  channel: NotificationChannel;
  enabled: boolean;
  /** Время напоминаний о чек-ине («HH:MM»). */
  times: string[];
  /** Время «итога дня». */
  summaryTime: string;
  quietHours: QuietHours;
  /** Переопределение часового пояса; null — часовой пояс профиля. */
  timezone: string | null;
  /** Включён ли каждый тип в этом канале. */
  types: Record<NotificationType, boolean>;
}

export function defaultChannelSettings(channel: NotificationChannel): ChannelSettingsConfig {
  return {
    channel,
    enabled: true,
    times: timesForCount(DEFAULT_TIMES_PER_DAY),
    summaryTime: DEFAULT_SUMMARY_TIME,
    quietHours: { ...DEFAULT_QUIET_HOURS },
    timezone: null,
    types: Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, true])) as Record<
      NotificationType,
      boolean
    >,
  };
}

/** Состояние канала для экрана настроек: привязка + настройки. */
export interface NotificationChannelStatus extends ChannelSettingsConfig {
  /** Задан ли токен бота на сервере. */
  configured: boolean;
  linked: boolean;
  /** Привязка есть, но доставка остановлена (бот заблокирован). */
  blocked: boolean;
  accountLabel: string | null;
}

export const ChannelSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  times: z.array(z.string().regex(HHMM)).min(MIN_TIMES_PER_DAY).max(MAX_TIMES_PER_DAY).optional(),
  summaryTime: z.string().regex(HHMM).optional(),
  quietHours: QuietHoursSchema.optional(),
  timezone: z.string().min(1).max(64).nullable().optional(),
  types: z.partialRecord(NotificationTypeSchema, z.boolean()).optional(),
});
export type ChannelSettingsUpdateInput = z.infer<typeof ChannelSettingsUpdateSchema>;

/** Статусы записи в outbox. */
export const DELIVERY_STATUSES = ['queued', 'sent', 'failed', 'blocked'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Строка журнала доставок для пользователя. */
export interface NotificationDeliveryDto {
  id: string;
  channel: NotificationChannel;
  type: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** Метрики outbox: количество записей по статусам. */
export interface NotificationMetricsResponse {
  counts: Record<DeliveryStatus, number>;
  byChannel: Record<string, Record<DeliveryStatus, number>>;
}

/** Состояние Discord-бота и привязки (зеркало Telegram). */
export interface DiscordStatusResponse {
  enabled: boolean;
  linked: boolean;
  blocked: boolean;
  username: string | null;
  linkedAt: string | null;
}
