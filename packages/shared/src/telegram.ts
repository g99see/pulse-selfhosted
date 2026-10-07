// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Контракты ботов «Пульса» (ТЗ §6): общие для API и web, чтобы клиент настроек
 * показывал состояние привязки и подключал бота одной кнопкой без дублирования
 * типов. Пользователю не нужно создавать собственного бота через BotFather —
 * на сервисе один общий бот Pulse.
 */

/** Состояние Telegram-бота и привязки текущего пользователя. */
export interface TelegramStatusResponse {
  /** Задан ли TELEGRAM_BOT_TOKEN: без него модуль неактивен. */
  enabled: boolean;
  mode: 'webhook' | 'polling';
  linked: boolean;
  /** Бот заблокирован пользователем: доставка остановлена. */
  blocked: boolean;
  chatUsername: string | null;
  /** Имя общего бота Pulse, полученное из env или getMe; null — неизвестно. */
  botUsername: string | null;
  linkedAt: string | null;
}

/**
 * Одноразовая ссылка-подключение бота (ТЗ §6): кнопка «Подключить» отдаёт URL,
 * по которому пользователь открывает бота (Message) или OAuth-подтверждение
 * (Discord). Токен привязки живёт 10 минут, в БД хранится только его хеш.
 */
export interface BotConnectLinkResponse {
  /** Куда вести пользователя: deep-link на бота (Telegram) или OAuth-ссылка (Discord). */
  url: string;
  /** ISO-время истечения привязки. */
  expiresAt: string;
  /** Сколько секунд действует ссылка. */
  ttlSeconds: number;
}
