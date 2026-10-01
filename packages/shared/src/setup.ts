// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Мастер первого запуска и режим регистрации инстанса (ТЗ §9 п.7, §10).
 * Общие схемы для API и web: валидация входа мастера и контракт статуса.
 */
import { z } from 'zod';
import { LocaleSchema, emailSchema, nicknameSchema, passwordSchema, type PublicUser } from './auth';

/** Роли пользователя (ТЗ §9 п.7): первый пользователь мастера — admin. */
export const RoleSchema = z.enum(['user', 'moderator', 'admin']);
export type Role = z.infer<typeof RoleSchema>;
export const ROLES: readonly Role[] = RoleSchema.options;

/**
 * Режим регистрации инстанса:
 * - open   — регистрация свободна (по умолчанию);
 * - invite — только по приглашению (механизм приглашений появится позже,
 *            поэтому регистрация отклоняется);
 * - closed — регистрация закрыта, `POST /auth/register` отвечает
 *            403 registration_closed.
 */
export const RegistrationModeSchema = z.enum(['open', 'invite', 'closed']);
export type RegistrationMode = z.infer<typeof RegistrationModeSchema>;
export const REGISTRATION_MODES: readonly RegistrationMode[] = RegistrationModeSchema.options;

/** Вход мастера первого запуска: первый администратор инстанса. */
export const SetupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  nickname: nicknameSchema,
  locale: LocaleSchema.default('ru'),
});
export type SetupInput = z.infer<typeof SetupSchema>;
export type SetupInputValues = z.input<typeof SetupSchema>;

/** Ответ `GET /api/setup/status`. */
export interface SetupStatusResponse {
  needsSetup: boolean;
  registrationMode: RegistrationMode;
}

/** Ответ `POST /api/setup`. */
export interface SetupResponse {
  user: PublicUser;
}
