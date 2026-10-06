// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистый выбор «созревших» плановых уведомлений (ТЗ §3.6, v2 §5): по настройкам
 * канала и окну времени (from, to] решает, что пора отправлять. Без обращений
 * к БД и сети — пригодно для unit-тестов.
 *
 * Плановые типы: checkins (список времён канала) и daily_summary (одно время).
 * Остальные типы событийные и ставятся в очередь сразу из кода.
 */
import {
  DEFAULT_QUIET_HOURS,
  DEFAULT_SUMMARY_TIME,
  DEFAULT_TIMES_PER_DAY,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  defaultChannelSettings,
  deliveryOccurredBetween,
  normalizeTimes,
  parseTimeOfDay,
  timesForCount,
  type ChannelSettingsConfig,
  type DeliveryWindow,
  type NotificationChannel,
  type NotificationType,
  type QuietHours,
} from '@puls/shared';

/** Строка настроек канала, как её отдаёт Prisma. */
export interface StoredChannelSetting {
  channel: string;
  enabled: boolean;
  schedule: unknown;
  quietStart: number;
  quietEnd: number;
  timezone: string | null;
}

/** Строка правила (тип × канал), как её отдаёт Prisma. */
export interface StoredRule {
  type: string;
  channel: string;
  enabled: boolean;
}

export interface UserNotificationSource {
  id: string;
  timezone: string;
  /** Только каналы, в которые можно доставлять (привязан и не заблокирован). */
  channels: ChannelSettingsConfig[];
}

export interface DueDelivery {
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  times: string[];
  quietHours: QuietHours;
}

const TYPE_SET = new Set<string>(NOTIFICATION_TYPES);
const CHANNEL_SET = new Set<string>(NOTIFICATION_CHANNELS);

export function isKnownType(value: string): value is NotificationType {
  return TYPE_SET.has(value);
}

export function isKnownChannel(value: string): value is NotificationChannel {
  return CHANNEL_SET.has(value);
}

/** Достаёт список времён из JSON-расписания {"times": [...]}. */
export function scheduleTimes(schedule: unknown): string[] {
  if (
    schedule &&
    typeof schedule === 'object' &&
    Array.isArray((schedule as { times?: unknown }).times)
  ) {
    return normalizeTimes((schedule as { times: string[] }).times);
  }
  return timesForCount(DEFAULT_TIMES_PER_DAY);
}

/** Время «итога дня» из JSON-расписания. */
export function scheduleSummaryTime(schedule: unknown): string {
  const value =
    schedule && typeof schedule === 'object'
      ? (schedule as { summaryTime?: unknown }).summaryTime
      : undefined;
  return typeof value === 'string' && parseTimeOfDay(value) ? value : DEFAULT_SUMMARY_TIME;
}

/** Расписание в JSON для сохранения в БД. */
export function scheduleJson(
  times: readonly string[] | number | undefined,
  summaryTime: string = DEFAULT_SUMMARY_TIME,
): { times: string[]; summaryTime: string } {
  return { times: normalizeTimes(times), summaryTime };
}

/** Настройки канала: сохранённые значения поверх умолчаний + правила по типам. */
export function toChannelConfig(
  channel: NotificationChannel,
  stored: StoredChannelSetting | null | undefined,
  rules: readonly StoredRule[],
): ChannelSettingsConfig {
  const config = defaultChannelSettings(channel);
  if (stored) {
    config.enabled = stored.enabled;
    config.times = scheduleTimes(stored.schedule);
    config.summaryTime = scheduleSummaryTime(stored.schedule);
    config.quietHours = {
      start: stored.quietStart ?? DEFAULT_QUIET_HOURS.start,
      end: stored.quietEnd ?? DEFAULT_QUIET_HOURS.end,
    };
    config.timezone = stored.timezone;
  }
  for (const rule of rules) {
    if (rule.channel === channel && isKnownType(rule.type)) config.types[rule.type] = rule.enabled;
  }
  return config;
}

/** Часовой пояс канала: свой, если задан, иначе пояс профиля. */
export function channelTimezone(config: ChannelSettingsConfig, userTimezone: string): string {
  return config.timezone || userTimezone || 'UTC';
}

/** Плановые уведомления, которым пора отправляться в окне (from, to] у одного пользователя. */
export function dueDeliveriesForUser(
  user: UserNotificationSource,
  window: Pick<DeliveryWindow, 'from' | 'to'>,
): DueDelivery[] {
  const deliveries: DueDelivery[] = [];

  for (const config of user.channels) {
    if (!config.enabled) continue;
    const timezone = channelTimezone(config, user.timezone);

    const scheduled: { type: NotificationType; times: string[] }[] = [
      { type: 'checkins', times: config.times },
      { type: 'daily_summary', times: [config.summaryTime] },
    ];
    for (const item of scheduled) {
      if (!config.types[item.type]) continue;
      const due = deliveryOccurredBetween(
        { from: window.from, to: window.to, timezone },
        { times: item.times, quietHours: config.quietHours },
      );
      if (!due) continue;
      deliveries.push({
        userId: user.id,
        type: item.type,
        channel: config.channel,
        times: item.times,
        quietHours: config.quietHours,
      });
    }
  }

  return deliveries;
}
