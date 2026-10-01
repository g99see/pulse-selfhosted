// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистый выбор «созревших» уведомлений для планировщика (ТЗ §3.6, §9):
 * превращает строки правил из БД в конфиг и по окну времени (from, to] решает,
 * каким типам пора отправлять. Без обращений к БД и сети — пригодно для
 * unit-тестов.
 */
import {
  DEFAULT_QUIET_HOURS,
  DEFAULT_TIMES_PER_DAY,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  deliveryOccurredBetween,
  normalizeTimes,
  timesForCount,
  type DeliveryWindow,
  type NotificationChannel,
  type NotificationRuleConfig,
  type NotificationType,
  type QuietHours,
} from '@puls/shared';

/** Строка правила, как её отдаёт Prisma. */
export interface StoredRule {
  type: string;
  channel: string;
  schedule: unknown;
  quietHoursStart: number;
  quietHoursEnd: number;
  enabled: boolean;
}

export interface UserNotificationSource {
  id: string;
  email: string;
  timezone: string;
  notificationRules: StoredRule[];
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

/** Достаёт список времен из JSON-расписания {"times": ["09:00", ...]}. */
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

/** Расписание в JSON для сохранения в БД. */
export function scheduleJson(times: readonly string[] | number | undefined): { times: string[] } {
  return { times: normalizeTimes(times) };
}

function isKnownType(value: string): value is NotificationType {
  return TYPE_SET.has(value);
}

function isKnownChannel(value: string): value is NotificationChannel {
  return CHANNEL_SET.has(value);
}

/** Строка БД → конфиг правила; null — если тип или канал неизвестен. */
export function toRuleConfig(rule: StoredRule): NotificationRuleConfig | null {
  if (!isKnownType(rule.type) || !isKnownChannel(rule.channel)) return null;
  return {
    type: rule.type,
    channel: rule.channel,
    enabled: rule.enabled,
    times: scheduleTimes(rule.schedule),
    quietHours: {
      start: rule.quietHoursStart ?? DEFAULT_QUIET_HOURS.start,
      end: rule.quietHoursEnd ?? DEFAULT_QUIET_HOURS.end,
    },
  };
}

/** Уведомления, которым пора отправляться в окне (from, to] у одного пользователя. */
export function dueDeliveriesForUser(
  user: UserNotificationSource,
  window: DeliveryWindow,
): DueDelivery[] {
  const deliveries: DueDelivery[] = [];

  for (const rule of user.notificationRules) {
    const config = toRuleConfig(rule);
    if (!config || !config.enabled) continue;

    const due = deliveryOccurredBetween(
      { from: window.from, to: window.to, timezone: window.timezone },
      { times: config.times, quietHours: config.quietHours },
    );
    if (!due) continue;

    deliveries.push({
      userId: user.id,
      type: config.type,
      channel: config.channel,
      times: config.times,
      quietHours: config.quietHours,
    });
  }

  return deliveries;
}
