// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Доступность внешних провайдеров входа (ТЗ §3.1, §7). Ключи задаёт владелец
 * инстанса; без них провайдер выключен, эндпоинты отвечают 404, а кнопки в UI
 * не показываются. Конфигурация читается из окружения на каждый вызов, чтобы
 * тесты могли подменять env без перезапуска.
 */
export type ExternalProviderId = 'google' | 'telegram';

export const EXTERNAL_PROVIDERS: readonly ExternalProviderId[] = ['google', 'telegram'];

export type EnvLike = Record<string, string | undefined>;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface TelegramConfig {
  botToken: string;
  botUsername: string;
}

export interface ProviderAvailability {
  google: boolean;
  telegram: boolean;
  telegramBotUsername: string | null;
}

function envValue(env: EnvLike, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Google OAuth включён только при обеих непустых переменных. */
export function googleConfig(env: EnvLike = process.env): GoogleConfig | null {
  const clientId = envValue(env, 'GOOGLE_CLIENT_ID');
  const clientSecret = envValue(env, 'GOOGLE_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Telegram Login Widget включён только при токене и имени бота. */
export function telegramConfig(env: EnvLike = process.env): TelegramConfig | null {
  const botToken = envValue(env, 'TELEGRAM_BOT_TOKEN');
  const botUsername = envValue(env, 'TELEGRAM_BOT_USERNAME');
  return botToken && botUsername ? { botToken, botUsername } : null;
}

/** Что показывать в UI (GET /api/auth/providers). */
export function providerAvailability(env: EnvLike = process.env): ProviderAvailability {
  const google = googleConfig(env);
  const telegram = telegramConfig(env);
  return {
    google: google !== null,
    telegram: telegram !== null,
    telegramBotUsername: telegram?.botUsername ?? null,
  };
}

/** Человеческое имя провайдера для списка привязок. */
export function providerLabel(provider: ExternalProviderId): string {
  return provider === 'google' ? 'Google' : 'Telegram';
}
