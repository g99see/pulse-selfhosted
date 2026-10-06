// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Контракты Telegram-бота «Пульса» (ТЗ §3.6, §4): общие для API и web, чтобы
 * клиент настроек показывал состояние привязки без дублирования типов.
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
  linkedAt: string | null;
}

/** Одноразовый код привязки чата (TTL 10 минут, в БД только хеш). */
export interface TelegramLinkCodeResponse {
  code: string;
  expiresAt: string;
  ttlSeconds: number;
}
