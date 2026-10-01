// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент социального API (ТЗ §3.7): подписки, лента, реакции и комментарии.
 * Все запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  CommentDto,
  FeedPage,
  FollowStateDto,
  ReactionSummary,
  SocialUserRef,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const socialApi = {
  follow: (nickname: string) =>
    authFetch<FollowStateDto>(`/api/follows/${encodeURIComponent(nickname)}`, { method: 'POST' }),

  unfollow: (nickname: string) =>
    authFetch<void>(`/api/follows/${encodeURIComponent(nickname)}`, { method: 'DELETE' }),

  state: (nickname: string) =>
    authFetch<FollowStateDto>(`/api/follows/${encodeURIComponent(nickname)}`),

  followers: () => authFetch<{ users: SocialUserRef[] }>('/api/follows/followers'),

  following: () => authFetch<{ users: SocialUserRef[] }>('/api/follows/following'),

  feed: (cursor?: string) =>
    authFetch<FeedPage>(`/api/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

  react: (postId: string, emoji: string) =>
    authFetch<ReactionSummary[]>(`/api/posts/${postId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  unreact: (postId: string, emoji: string) =>
    authFetch<void>(`/api/posts/${postId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE',
    }),

  comments: (postId: string) => authFetch<CommentDto[]>(`/api/posts/${postId}/comments`),

  addComment: (postId: string, body: string) =>
    authFetch<CommentDto>(`/api/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  deleteComment: (commentId: string) =>
    authFetch<void>(`/api/comments/${commentId}`, { method: 'DELETE' }),
};
