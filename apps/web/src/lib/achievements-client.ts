// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API достижений (ТЗ §4): список бейджей с прогрессом и текущий стрик.
 * Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type { AchievementsResponse, StreakDto } from '@puls/shared';
import { authFetch } from './auth-client';

export const achievementsApi = {
  list: () => authFetch<AchievementsResponse>('/api/achievements'),

  streak: () => authFetch<StreakDto>('/api/achievements/streak'),
};
