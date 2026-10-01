// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Session, User } from '@prisma/client';
import type { Request } from 'express';

/** Запрос, прошедший SessionGuard: несёт пользователя и его сессию. */
export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: Session;
  /** Токен открытого API, если запрос прошёл ApiTokenGuard (ТЗ §4). */
  apiToken?: { id: string; scopes: string[] };
}
