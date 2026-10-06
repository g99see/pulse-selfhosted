// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Тексты уведомлений (ТЗ §3.6, §5, v2 §5). Чистые функции: по типу уведомления
 * и локальному времени собирают сообщение для мессенджера (Telegram/Discord).
 * Для чек-инов в Telegram к сообщению добавляются кнопки 1–5 (kind = checkin).
 */
import {
  budgetLevel,
  formatMoney,
  isCurrency,
  localParts,
  type NotificationType,
  type StatsDayResponse,
} from '@puls/shared';

/** Сообщение в очереди доставки (хранится в outbox как payload). */
export interface NotificationMessage {
  type: string;
  title: string;
  body: string;
  /** Путь на сайте, куда ведёт уведомление. */
  url?: string;
  /** checkin — Telegram добавит inline-кнопки настроения. */
  kind?: 'checkin';
}

export interface NotificationBuildContext {
  now: Date;
  timezone: string;
}

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

/** Сообщение по типу уведомления (ТЗ §3.6). */
export function buildMessage(
  type: NotificationType,
  context: NotificationBuildContext,
): NotificationMessage {
  switch (type) {
    case 'checkins': {
      const greeting = checkinGreeting(context);
      return {
        type,
        title: greeting.title,
        body: greeting.body,
        kind: 'checkin',
        url: '/app',
      };
    }
    case 'daily_summary':
      return {
        type,
        title: 'Итог дня',
        body: 'Загляните в «Пульс»: траты, доходы и настроение за день.',
        url: '/app',
      };
    case 'reconciliation_mismatch':
      return {
        type,
        title: 'Баланс не сходится',
        body: 'Остаток на счёте отличается от суммы операций. Проверьте счета.',
        url: '/app/finance',
      };
    case 'payments':
      return {
        type,
        title: 'Скоро платёж',
        body: 'Проверьте регулярные платежи на этой неделе.',
        url: '/app/finance',
      };
    case 'budget':
      return {
        type,
        title: 'Бюджет под присмотром',
        body: 'Расходы приближаются к лимиту по категории.',
        url: '/app/finance',
      };
    case 'weekly_report':
      return {
        type,
        title: 'Недельный отчёт готов',
        body: 'Ваши финансы и настроение за неделю собраны.',
        url: '/app',
      };
    case 'reactions':
      return {
        type,
        title: 'Новая реакция',
        body: 'Кто-то отреагировал на вашу запись.',
        url: '/app/profile',
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
export function buildPostActivityNotification(info: PostActivityInfo): NotificationMessage {
  const title = info.kind === 'reaction' ? 'Новая реакция' : 'Новый комментарий';
  const body =
    info.kind === 'reaction'
      ? `@${info.actorNickname} поставил ${info.emoji ?? '👍'} вашей записи.`
      : `@${info.actorNickname}: ${info.preview ?? 'comment'}`;
  return {
    type: 'reactions',
    title,
    body,
    url: '/feed',
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
export function buildCapsuleOpenedNotification(info: CapsuleOpenedInfo): NotificationMessage {
  return {
    type: 'capsule',
    title: 'Капсула времени открылась',
    body: `Письмо «${info.title}» дождалось срока — загляните в него.`,
    url: '/capsules',
  };
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

/** Итог дня: траты, доходы, настроение и число чек-инов (v2 §5). */
export function buildDailySummary(day: StatsDayResponse): NotificationMessage {
  const currency = isCurrency(day.currency) ? day.currency : 'RUB';
  const mood = day.avgMood === null ? 'нет данных' : `${day.avgMood.toFixed(1)}/5`;
  return {
    type: 'daily_summary',
    title: `Итог дня, ${day.day}`,
    body: [
      `💸 Потрачено: ${formatMoney(day.spent, currency)}`,
      `💰 Получено: ${formatMoney(day.earned, currency)}`,
      `🙂 Настроение: ${mood}`,
      `✅ Чек-инов: ${day.checkins}`,
    ].join('\n'),
    url: '/app',
  };
}

export interface BudgetAlertInfo {
  categoryName: string;
  limit: number;
  spent: number;
  currency: string;
}

/** Предупреждение бюджета: 80% — «почти», 100% и выше — «превышен». */
export function buildBudgetAlert(info: BudgetAlertInfo): NotificationMessage | null {
  const status = budgetLevel(info.limit, info.spent);
  if (status.level === 'ok') return null;
  const currency = isCurrency(info.currency) ? info.currency : 'RUB';
  const amounts = `${formatMoney(info.spent, currency)} из ${formatMoney(info.limit, currency)}`;
  return status.level === 'exceeded'
    ? {
        type: 'budget',
        title: `Бюджет «${info.categoryName}» превышен`,
        body: `Потрачено ${amounts} (${status.percent}%).`,
        url: '/app/finance',
      }
    : {
        type: 'budget',
        title: `Бюджет «${info.categoryName}»: ${status.percent}%`,
        body: `Потрачено ${amounts}. Лимит близко.`,
        url: '/app/finance',
      };
}

export interface ReconciliationMismatchInfo {
  accountName: string;
  /** Уже отформатированная разница, например «−120 ₽». */
  difference: string;
}

/** Расхождение баланса счёта и суммы операций (хук для сверки, v2 §5). */
export function buildReconciliationMismatch(info: ReconciliationMismatchInfo): NotificationMessage {
  return {
    type: 'reconciliation_mismatch',
    title: 'Баланс не сходится',
    body: `Счёт «${info.accountName}»: расхождение ${info.difference}. Проверьте операции.`,
    url: '/app/finance',
  };
}
