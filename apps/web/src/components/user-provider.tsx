// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { PublicUser } from '@puls/shared';

const UserContext = createContext<PublicUser | null>(null);

/**
 * Профиль текущего пользователя для клиентских компонентов кабинета (ТЗ §8).
 * Нужен там, где решения зависят от часового пояса ПОЛЬЗОВАТЕЛЯ (профиля), а не
 * устройства: например, показ шага сна и расчёт слота чек-ина должны совпадать с
 * сервером, который гейтит сон по поясу профиля.
 */
export function UserProvider({ user, children }: { user: PublicUser; children: ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

/** Профиль пользователя; вне провайдера — null (для безопасного дефолта). */
export function useUser(): PublicUser | null {
  return useContext(UserContext);
}
