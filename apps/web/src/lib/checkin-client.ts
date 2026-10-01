// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API чек-инов (ТЗ §3.3): ответ настроением, расширенный чек-ин,
 * заполнение задним числом, история за период и расписание напоминаний.
 * Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  CheckInDto,
  CheckInInputValues,
  CheckInScheduleDto,
  CheckInScheduleInput,
  CheckInUpdateInput,
} from '@puls/shared';
import { authFetch } from './auth-client';

export interface CheckInsFilter {
  from?: string;
  to?: string;
  limit?: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export const checkinApi = {
  create: (input: CheckInInputValues) =>
    authFetch<CheckInDto>('/api/checkins', { method: 'POST', body: JSON.stringify(input) }),

  /** Ответ за 5 секунд: только настроение (ТЗ §3.3). */
  quick: (mood: number, slot?: string) =>
    authFetch<CheckInDto>('/api/checkins/quick', {
      method: 'POST',
      body: JSON.stringify({ mood, slot }),
    }),

  list: (filter: CheckInsFilter = {}) =>
    authFetch<{ checkIns: CheckInDto[] }>(`/api/checkins${query({ ...filter })}`),

  today: () => authFetch<{ dayKey: string; checkIns: CheckInDto[] }>('/api/checkins/today'),

  get: (id: string) => authFetch<CheckInDto>(`/api/checkins/${id}`),

  update: (id: string, input: CheckInUpdateInput) =>
    authFetch<CheckInDto>(`/api/checkins/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  remove: (id: string) => authFetch<void>(`/api/checkins/${id}`, { method: 'DELETE' }),

  schedule: () => authFetch<{ schedule: CheckInScheduleDto }>('/api/checkins/schedule'),

  saveSchedule: (input: CheckInScheduleInput) =>
    authFetch<{ schedule: CheckInScheduleDto }>('/api/checkins/schedule', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};

/** Событие «чек-ины изменились» — главная и страница перечитывают данные. */
export const CHECKIN_CHANGED_EVENT = 'puls:checkin-changed';

export function notifyCheckInChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHECKIN_CHANGED_EVENT));
}
