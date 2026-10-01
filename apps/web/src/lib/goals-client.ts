// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API целей накоплений (ТЗ §3.2): CRUD и пополнения с вехами.
 * Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  GoalCreateValues,
  GoalDepositInput,
  GoalDepositResult,
  GoalDto,
  GoalUpdateInput,
  GoalsListResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const goalsApi = {
  list: () => authFetch<GoalsListResponse>('/api/goals'),

  get: (id: string) => authFetch<GoalDto>(`/api/goals/${id}`),

  create: (input: GoalCreateValues) =>
    authFetch<GoalDto>('/api/goals', { method: 'POST', body: JSON.stringify(input) }),

  update: (id: string, input: GoalUpdateInput) =>
    authFetch<GoalDto>(`/api/goals/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  remove: (id: string) => authFetch<void>(`/api/goals/${id}`, { method: 'DELETE' }),

  deposit: (id: string, input: GoalDepositInput) =>
    authFetch<GoalDepositResult>(`/api/goals/${id}/deposit`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/** Событие «цели изменились» — карточка на главной перечитывает прогресс. */
export const GOALS_CHANGED_EVENT = 'puls:goals-changed';

export function notifyGoalsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GOALS_CHANGED_EVENT));
}
