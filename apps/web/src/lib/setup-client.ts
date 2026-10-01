// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API мастера первого запуска (ТЗ §9 п.7, §10): cookie-сессии и CSRF
 * обрабатывает общий `authFetch`.
 */
import type { SetupInputValues, SetupResponse, SetupStatusResponse } from '@puls/shared';
import { authFetch } from './auth-client';

export const setupApi = {
  status: () => authFetch<SetupStatusResponse>('/api/setup/status'),

  create: (input: SetupInputValues) =>
    authFetch<SetupResponse>('/api/setup', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
