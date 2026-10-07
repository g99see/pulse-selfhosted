// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Внешние способы входа — Google (ТЗ §3.1, §7; вход через Telegram удалён в v3 §7.3).
 * Схемы и типы общие для API и web: список включённых провайдеров и
 * привязанные учётные записи.
 */
import { z } from 'zod';

export const ExternalProviderSchema = z.enum(['google']);
export type ExternalProviderId = z.infer<typeof ExternalProviderSchema>;

export const EXTERNAL_PROVIDER_IDS: readonly ExternalProviderId[] = ['google'];

/** `GET /api/auth/providers` — что включил владелец инстанса. */
export interface ProvidersResponse {
  google: boolean;
}

/** Привязанная внешняя учётная запись в ответах API. */
export interface LinkedIdentity {
  provider: ExternalProviderId;
  email: string | null;
  createdAt: string;
}

/** `GET /api/auth/identities` — способы входа текущего пользователя. */
export interface IdentitiesResponse {
  email: string;
  passwordSet: boolean;
  identities: LinkedIdentity[];
}
