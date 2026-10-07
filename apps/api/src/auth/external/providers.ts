// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Доступность внешних провайдеров входа (ТЗ §3.1, §7). Ключи задаёт владелец
 * инстанса; без них провайдер выключен, эндпоинты отвечают 404, а кнопки в UI
 * не показываются. Конфигурация читается из окружения на каждый вызов, чтобы
 * тесты могли подменять env без перезапуска.
 */
export type ExternalProviderId = 'google';

export const EXTERNAL_PROVIDERS: readonly ExternalProviderId[] = ['google'];

export type EnvLike = Record<string, string | undefined>;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface ProviderAvailability {
  google: boolean;
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

/** Что показывать в UI (GET /api/auth/providers). */
export function providerAvailability(env: EnvLike = process.env): ProviderAvailability {
  return { google: googleConfig(env) !== null };
}

/** Человеческое имя провайдера для списка привязок. */
export function providerLabel(provider: ExternalProviderId): string {
  return provider === 'google' ? 'Google' : provider;
}
