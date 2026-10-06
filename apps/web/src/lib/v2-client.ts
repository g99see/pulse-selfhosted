// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API v2: приватная ссылка «Итог дня», цель чек-инов и метрики
 * экземпляра (admin). Запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type { CheckinGoalDto, DaySummaryLinkCreatedDto, DaySummaryLinkDto } from '@puls/shared';
import { authFetch } from './auth-client';

export interface AdminMetrics {
  startedAt: string;
  uptimeSeconds: number;
  errorsSinceStart: number;
  lastSchedulerRunAt: string | null;
  queueLength: number;
  deliveries: {
    counts: Record<string, number>;
    byChannel: Record<string, Record<string, number>>;
  };
}

export const daySummaryApi = {
  status: () => authFetch<DaySummaryLinkDto>('/api/day-summary-link'),
  create: () => authFetch<DaySummaryLinkCreatedDto>('/api/day-summary-link', { method: 'POST' }),
  revoke: () => authFetch<void>('/api/day-summary-link', { method: 'DELETE' }),
};

export const checkinGoalApi = {
  get: () => authFetch<CheckinGoalDto>('/api/checkins/goal'),
  set: (perWeek: number | null) =>
    authFetch<CheckinGoalDto>('/api/checkins/goal', {
      method: 'PUT',
      body: JSON.stringify({ perWeek }),
    }),
};

export const metricsApi = {
  get: () => authFetch<AdminMetrics>('/api/admin/metrics'),
};
