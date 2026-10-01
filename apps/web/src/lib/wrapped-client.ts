// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API «Год в цифрах» (ТЗ §4, J1): итоговая история за календарный год.
 * Запрос идёт через authFetch — cookie-сессия + CSRF, данные только пользователя.
 */
import type { WrappedResponse } from '@puls/shared';
import { authFetch } from './auth-client';

export const wrappedApi = {
  year: (year?: number) => authFetch<WrappedResponse>(`/api/wrapped${year ? `?year=${year}` : ''}`),
};
