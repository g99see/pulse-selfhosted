// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Двухфакторная аутентификация TOTP (ТЗ §6): схемы и типы, общие для API и web.
 */
import { z } from 'zod';
import type { PublicUser } from './auth';

/** TOTP-код: ровно 6 цифр. */
export const TOTP_CODE_REGEX = /^\d{6}$/;

/** Резервный код — 10 символов base32, обычно с дефисом посередине. */
export const BACKUP_CODE_COUNT = 10;

/** Один код из набора: TOTP (6 цифр) или резервный. */
export const TwoFactorCodeSchema = z
  .string()
  .trim()
  .min(6, { message: 'Код слишком короткий' })
  .max(24, { message: 'Код слишком длинный' });

export const TwoFactorEnableSchema = z.object({
  code: TwoFactorCodeSchema,
});
export type TwoFactorEnableInput = z.infer<typeof TwoFactorEnableSchema>;

export const TwoFactorDisableSchema = z.object({
  password: z.string().min(1, { message: 'Введите пароль' }).max(128),
  code: TwoFactorCodeSchema,
});
export type TwoFactorDisableInput = z.infer<typeof TwoFactorDisableSchema>;

export const TwoFactorLoginSchema = z.object({
  challengeToken: z.string().min(10).max(200),
  code: TwoFactorCodeSchema,
});
export type TwoFactorLoginInput = z.infer<typeof TwoFactorLoginSchema>;

/** Ответ входа, когда пароль верен, но нужен второй фактор. */
export interface TwoFactorRequiredResponse {
  twoFactorRequired: true;
  challengeToken: string;
}

/** Обычный успешный вход: сессия выдана, отдаём пользователя. */
export interface LoginResponse {
  user: PublicUser;
}

export type LoginResult = LoginResponse | TwoFactorRequiredResponse;

export interface TwoFactorStatus {
  enabled: boolean;
  /** false — на сервере нет APP_ENCRYPTION_KEY, 2FA недоступна. */
  available: boolean;
}

export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUri: string;
  /** SVG data-URL; null — если QR не удалось построить (всегда есть URI). */
  qrDataUrl: string | null;
  issuer: string;
  account: string;
}

export interface TwoFactorEnableResponse {
  backupCodes: string[];
}

export function isTwoFactorRequired(value: unknown): value is TwoFactorRequiredResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { twoFactorRequired?: unknown }).twoFactorRequired === true
  );
}
