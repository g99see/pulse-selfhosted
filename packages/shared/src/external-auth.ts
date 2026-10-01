// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Внешние способы входа — Google и Telegram (ТЗ §3.1, §7). Схемы и типы общие
 * для API и web: список включённых провайдеров, данные виджета Telegram и
 * привязанные учётные записи.
 */
import { z } from 'zod';

export const ExternalProviderSchema = z.enum(['google', 'telegram']);
export type ExternalProviderId = z.infer<typeof ExternalProviderSchema>;

export const EXTERNAL_PROVIDER_IDS: readonly ExternalProviderId[] = ['google', 'telegram'];

/** `GET /api/auth/providers` — что включил владелец инстанса. */
export interface ProvidersResponse {
  google: boolean;
  telegram: boolean;
  telegramBotUsername: string | null;
}

/**
 * Данные, которые присылает Telegram Login Widget. `id` и `auth_date` приходят
 * числом либо строкой — нормализуем в строку. Схема «свободная» (looseObject):
 * неизвестные поля сохраняются, иначе подпись по ним не сойдётся.
 */
export const TelegramAuthSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).transform((value) => String(value)),
  first_name: z.string().max(128).optional(),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().max(512).optional(),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string().min(1).max(128),
});
export type TelegramAuthInput = z.input<typeof TelegramAuthSchema>;

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
