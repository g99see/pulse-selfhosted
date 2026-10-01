// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API привычек (ТЗ §4, P2): CRUD, отметки за день, блок «сегодня» и
 * статистика. Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  HabitCreateValues,
  HabitDto,
  HabitLogResult,
  HabitStatsResponse,
  HabitTodayResponse,
  HabitUpdateInput,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const habitsApi = {
  list: () => authFetch<{ habits: HabitDto[] }>('/api/habits'),

  today: () => authFetch<HabitTodayResponse>('/api/habits/today'),

  stats: () => authFetch<HabitStatsResponse>('/api/habits/stats'),

  create: (input: HabitCreateValues) =>
    authFetch<HabitDto>('/api/habits', { method: 'POST', body: JSON.stringify(input) }),

  update: (id: string, input: HabitUpdateInput) =>
    authFetch<HabitDto>(`/api/habits/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  remove: (id: string) => authFetch<void>(`/api/habits/${id}`, { method: 'DELETE' }),

  /** Идемпотентная отметка за дату (по умолчанию — сегодня в часовом поясе). */
  mark: (id: string, input: { date?: string; done?: boolean }) =>
    authFetch<HabitLogResult>(`/api/habits/${id}/log`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/** Событие «привычки изменились» — блок в чек-ине перечитывает отметки. */
export const HABITS_CHANGED_EVENT = 'puls:habits-changed';

export function notifyHabitsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HABITS_CHANGED_EVENT));
}
