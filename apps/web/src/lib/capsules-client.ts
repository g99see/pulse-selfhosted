// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API капсул времени (ТЗ §4, P2): список, создание, просмотр и удаление.
 * Все запросы идут через authFetch — cookie-сессия и CSRF.
 */
import type { CapsuleCreateInput, CapsuleDetailDto, CapsulesListResponse } from '@puls/shared';
import { authFetch } from './auth-client';

export const capsulesApi = {
  list: () => authFetch<CapsulesListResponse>('/api/capsules'),

  get: (id: string) => authFetch<CapsuleDetailDto>(`/api/capsules/${id}`),

  create: (input: CapsuleCreateInput) =>
    authFetch<CapsuleDetailDto>('/api/capsules', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  remove: (id: string) => authFetch<void>(`/api/capsules/${id}`, { method: 'DELETE' }),
};
