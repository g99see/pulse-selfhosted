// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент жалоб и модерации (ТЗ §3.7, §3.8). Использует cookie-сессию и CSRF
 * через authFetch, как остальные клиенты API.
 */
import type {
  ModerationAction,
  ModerationActionsResponse,
  ModerationResolveResponse,
  ReportCreateInput,
  ReportDto,
  ReportsResponse,
  ReportStatus,
} from '@puls/shared';
import { authFetch } from './auth-client';

/** Приём жалоб (ТЗ §3.7). */
export const reportApi = {
  create: (input: ReportCreateInput) =>
    authFetch<ReportDto>('/api/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/** Очередь и журнал модерации (ТЗ §3.8) — только для ролей модератора и admin. */
export const moderationApi = {
  reports: (status?: ReportStatus) =>
    authFetch<ReportsResponse>(
      `/api/moderation/reports${status ? `?status=${status}` : ''}`,
    ),

  actions: () => authFetch<ModerationActionsResponse>('/api/moderation/actions'),

  resolve: (id: string, action: ModerationAction, note?: string) =>
    authFetch<ModerationResolveResponse>(`/api/moderation/reports/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    }),
};
