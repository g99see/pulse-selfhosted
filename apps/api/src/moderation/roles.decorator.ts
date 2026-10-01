// SPDX-License-Identifier: AGPL-3.0-or-later
import { SetMetadata } from '@nestjs/common';

/** Ключ метаданных с ролями, которым доступен обработчик (ТЗ §2). */
export const ROLES_KEY = 'roles';

/**
 * Ограничивает доступ ролями (ТЗ §2): `@Roles('moderator', 'admin')`.
 * Работает в паре с RolesGuard, который читает эту метадату.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
