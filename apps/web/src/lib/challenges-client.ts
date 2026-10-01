// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент API челленджей (ТЗ §4, P2): список, создание, вступление по коду,
 * приглашение, отметка и рейтинг. Все запросы идут через authFetch.
 */
import type {
  ChallengeCreateValues,
  ChallengeDto,
  ChallengeInviteCandidateDto,
  ChallengeLeaderboardDto,
  ChallengesListResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const challengesApi = {
  list: () => authFetch<ChallengesListResponse>('/api/challenges'),

  get: (id: string) => authFetch<ChallengeDto>(`/api/challenges/${id}`),

  create: (input: ChallengeCreateValues) =>
    authFetch<ChallengeDto>('/api/challenges', { method: 'POST', body: JSON.stringify(input) }),

  update: (id: string, input: { title?: string; visibility?: string }) =>
    authFetch<ChallengeDto>(`/api/challenges/${id}`, { method: 'PUT', body: JSON.stringify(input) }),

  remove: (id: string) => authFetch<void>(`/api/challenges/${id}`, { method: 'DELETE' }),

  join: (code: string) =>
    authFetch<ChallengeDto>('/api/challenges/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  check: (id: string, ok: boolean) =>
    authFetch<ChallengeDto>(`/api/challenges/${id}/check`, {
      method: 'POST',
      body: JSON.stringify({ ok }),
    }),

  leaderboard: (id: string) => authFetch<ChallengeLeaderboardDto>(`/api/challenges/${id}/leaderboard`),

  inviteCandidates: (id: string) =>
    authFetch<{ users: ChallengeInviteCandidateDto[] }>(`/api/challenges/${id}/invite-candidates`),

  invite: (id: string, nickname: string) =>
    authFetch<ChallengeDto>(`/api/challenges/${id}/invite`, {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),
};
