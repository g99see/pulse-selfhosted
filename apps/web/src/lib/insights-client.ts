// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API инсайтов (ТЗ §3.5): лента рекомендаций, оценка «полезно / не
 * полезно», последнее наблюдение и применение предложения. Все запросы идут
 * через authFetch — cookie-сессия + CSRF.
 */
import type {
  InsightDto,
  InsightFeedback,
  InsightsApplyResponse,
  InsightsFeedResponse,
  InsightsFeedbackResponse,
  WeeklyReportResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const insightsApi = {
  feed: (limit?: number) =>
    authFetch<InsightsFeedResponse>(`/api/insights${limit ? `?limit=${limit}` : ''}`),

  latest: () => authFetch<{ insight: InsightDto | null }>('/api/insights/latest'),

  weekly: () => authFetch<WeeklyReportResponse | null>('/api/insights/weekly'),

  feedback: (id: string, feedback: InsightFeedback) =>
    authFetch<InsightsFeedbackResponse>(`/api/insights/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  apply: (id: string) =>
    authFetch<InsightsApplyResponse>(`/api/insights/${id}/apply`, { method: 'POST' }),
};
