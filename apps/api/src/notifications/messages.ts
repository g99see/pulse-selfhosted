// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Тексты уведомлений (ТЗ §3.6, §5, §9). Чистые функции: по типу уведомления и
 * локальному времени собирают payload для push и письма. Для чек-инов push
 * несёт кнопки ответа 1–5, чтобы ответить прямо из уведомления.
 */
import { localParts, type NotificationType } from '@puls/shared';
import type { PushPayload } from './push.service';

export interface NotificationBuildContext {
  now: Date;
  timezone: string;
}

/** Кнопки настроения 1–5 и путь API для ответа из уведомления (ТЗ §9). */
export const CHECKIN_ACTIONS: { action: string; title: string }[] = [
  { action: 'mood-1', title: '😞' },
  { action: 'mood-2', title: '🙁' },
  { action: 'mood-3', title: '😐' },
  { action: 'mood-4', title: '🙂' },
  { action: 'mood-5', title: '😄' },
];

/** Путь API чек-инов, куда service worker шлёт { mood } (ТЗ §3.3, §9). */
export const CHECKIN_API_PATH = '/api/checkins';

/** Приветствие чек-ина по локальному времени суток (ТЗ §5, сценарий 1). */
export function checkinGreeting(context: NotificationBuildContext): {
  title: string;
  body: string;
} {
  const { hour } = localParts(context.now, context.timezone);

  if (hour >= 5 && hour < 11) {
    return {
      title: 'Доброе утро! Как спалось?',
      body: 'Отметьте настроение — это займёт 5 секунд.',
    };
  }
  if (hour >= 11 && hour < 17) {
    return { title: 'Как проходит день?', body: 'Одно нажатие — и день записан.' };
  }
  if (hour >= 17 && hour < 23) {
    return { title: 'Как прошёл день?', body: 'Вечерний чек-ин: настроение и пара слов о дне.' };
  }
  return { title: 'Как вы?', body: 'Можно отметить настроение, если не спится.' };
}

/** Payload push-уведомления по типу (ТЗ §3.6). */
export function buildPushPayload(
  type: NotificationType,
  context: NotificationBuildContext,
): PushPayload {
  switch (type) {
    case 'checkins': {
      const greeting = checkinGreeting(context);
      return {
        type,
        title: greeting.title,
        body: greeting.body,
        checkinUrl: CHECKIN_API_PATH,
        actions: CHECKIN_ACTIONS,
        data: { url: '/app' },
      };
    }
    case 'payments':
      return {
        type,
        title: 'Скоро платёж',
        body: 'Проверьте регулярные платежи на этой неделе.',
        data: { url: '/app/finance' },
      };
    case 'budget':
      return {
        type,
        title: 'Бюджет под присмотром',
        body: 'Расходы приближаются к лимиту по категории.',
        data: { url: '/app/finance' },
      };
    case 'weekly_report':
      return {
        type,
        title: 'Недельный отчёт готов',
        body: 'Ваши финансы и настроение за неделю собраны.',
        data: { url: '/app' },
      };
    case 'reactions':
      return {
        type,
        title: 'Новая реакция',
        body: 'Кто-то отреагировал на вашу запись.',
        data: { url: '/app/profile' },
      };
  }
}

/** Данные события на посте (ТЗ §3.7): кто и как отреагировал на запись. */
export interface PostActivityInfo {
  actorNickname: string;
  kind: 'reaction' | 'comment';
  /** Эмодзи-реакция (для kind = reaction). */
  emoji?: string;
  /** Короткий предпросмотр текста комментария (для kind = comment). */
  preview?: string;
}

/**
 * Уведомление владельцу поста о новой реакции или комментарии (ТЗ §3.7) —
 * тип reactions, ссылка на ленту. Публикуется через NotificationDispatcher.
 */
export function buildPostActivityNotification(info: PostActivityInfo): PushPayload {
  const title = info.kind === 'reaction' ? 'Новая реакция' : 'Новый комментарий';
  const body =
    info.kind === 'reaction'
      ? `@${info.actorNickname} поставил ${info.emoji ?? '👍'} вашей записи.`
      : `@${info.actorNickname}: ${info.preview ?? 'comment'}`;
  return {
    type: 'reactions',
    title,
    body,
    data: { url: '/feed' },
  };
}

export interface CapsuleOpenedInfo {
  /** Заголовок открывшейся капсулы. */
  title: string;
}

/**
 * Уведомление «капсула открылась» (ТЗ §4, P2): письмо себе дождалось срока.
 * Публикуется через NotificationDispatcher; тип вне расписания, поэтому несёт
 * собственный url на экран капсул.
 */
export function buildCapsuleOpenedNotification(info: CapsuleOpenedInfo): PushPayload {
  return {
    type: 'capsule',
    title: 'Капсула времени открылась',
    body: `Письмо «${info.title}» дождалось срока — загляните в него.`,
    data: { url: '/capsules' },
  };
}

export interface NotificationEmail {
  subject: string;
  text: string;
  kind: string;
  link?: string;
}

/** Данные напоминания о регулярном платеже (ТЗ §3.2). */
export interface RecurringReminderInfo {
  name: string;
  /** Уже отформатированная сумма с валютой, например «30 000 ₽». */
  amount: string;
  /** Локальная дата списания, YYYY-MM-DD. */
  dueDate: string;
}

/** Напоминание за день до списания регулярного платежа (ТЗ §3.2). */
export function buildRecurringReminder(info: RecurringReminderInfo): {
  title: string;
  body: string;
  url: string;
} {
  return {
    title: 'Скоро регулярный платёж',
    body: `${info.name}: ${info.amount}, списание ${info.dueDate}. Проверьте, что на счёте хватает денег.`,
    url: '/app/finance',
  };
}

/** Письмо-уведомление по типу (ТЗ §3.6, канал email). */
export function buildNotificationEmail(
  type: NotificationType,
  context: NotificationBuildContext,
): NotificationEmail {
  const push = buildPushPayload(type, context);
  return {
    subject: `Пульс: ${push.title}`,
    text: `${push.title}\n\n${push.body}`,
    kind: `notification:${type}`,
    link: push.data?.url as string | undefined,
  };
}
