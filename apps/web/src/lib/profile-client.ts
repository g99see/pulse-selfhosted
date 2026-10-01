// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент публичного профиля (ТЗ §3.7): свой профиль и его редактирование.
 * Запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type { OwnProfileDto, ProfileUpdateInput, PublicProfileResponse } from '@puls/shared';
import { authFetch } from './auth-client';

export const profileApi = {
  get: () => authFetch<{ profile: OwnProfileDto }>('/api/profile'),

  update: (input: ProfileUpdateInput) =>
    authFetch<{ profile: OwnProfileDto }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** Публичная страница: чтение без входа (анонимный запрос к API). */
  public: (nickname: string) =>
    authFetch<PublicProfileResponse>(`/api/public/profiles/${encodeURIComponent(nickname)}`),
};

export type { PublicProfileDto } from '@puls/shared';
