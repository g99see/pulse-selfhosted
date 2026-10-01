// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API статистики (ТЗ §3.4): дашборд дня, отчёты за период и тепловая
 * карта настроения. Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  MoodCalendarResponse,
  StatsDayResponse,
  StatsPeriod,
  StatsReportResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export const statsApi = {
  day: (date?: string) => authFetch<StatsDayResponse>(`/api/stats/day${query({ date })}`),

  report: (period: StatsPeriod, date?: string) =>
    authFetch<StatsReportResponse>(`/api/stats/report${query({ period, date })}`),

  moodCalendar: (month: string) =>
    authFetch<MoodCalendarResponse>(`/api/stats/mood-calendar${query({ month })}`),
};
